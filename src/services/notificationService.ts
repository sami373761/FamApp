/**
 * Push registration: permission, token, and the one column that stores it.
 *
 * The Notifications switch used to store intent and nothing more — there was no
 * registration behind it. This file is that registration. It has three jobs and
 * deliberately no fourth: ask the device, ask Expo for a token, and put that
 * token on the caller's own `profiles` row (or take it off again).
 *
 * **The sender exists now, and it is entirely server-side.** Three triggers in
 * `20260829100000_push_notification_triggers.sql` hand chat and task events to
 * the `send-push` Edge Function, which is what finally reads this column.
 * Nothing in this file changes for it: registering is still the half a client
 * can own, and it deliberately knows nothing about who sends or why.
 *
 * That server half is **deployed and verified** on the live project: an insert
 * queues a request that returns HTTP 200. **A device still cannot receive
 * anything**, and that is now the only gap — none of the targets below can
 * obtain a token, so every send resolves to zero recipients. So the honest
 * description of the switch today is still "this device is registered to
 * receive notifications", not "you will be notified" — and the
 * arrival/departure pushes in the Premium table remain tier copy, because
 * nothing watches `locations` against `saved_places` regardless.
 *
 * Four ways this legitimately fails on a device that is working fine, which is
 * why `PushErrorCode` is wider than most:
 *
 *   * **web** — a browser push token needs VAPID keys and a service worker this
 *     project does not have. `UNSUPPORTED`.
 *   * **a simulator** — Apple and Google issue device tokens to hardware only,
 *     which is what `Device.isDevice` is read for. `UNSUPPORTED`.
 *   * **no EAS project id** — `getExpoPushTokenAsync` attributes a token to a
 *     project, and `app.json` carries no `extra.eas.projectId` because this app
 *     has never been through `eas init`. `NOT_CONFIGURED`, which names a setup
 *     step rather than pretending the device refused.
 *   * **Expo Go** — remote push was removed from Expo Go in SDK 53, so the
 *     token request throws there even on real hardware with permission granted.
 *     It lands on `TOKEN_UNAVAILABLE`; a development build is the fix, and the
 *     copy says so.
 *
 * A refusal is kept apart from all of those (`PERMISSION_DENIED`) because it is
 * the only one the user can undo, and the only one where the app should stop
 * asking — iOS shows its permission prompt exactly once per install.
 */

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  fail,
  guarded,
  ok,
  type CommonErrorCode,
  type ServiceError,
  type ServiceResult,
} from '@/services/result';
import { supabase } from '@/services/supabase';

export type PushErrorCode =
  /** The user said no. Permanent until they change it in system settings. */
  | 'PERMISSION_DENIED'
  /** Web, or a simulator — no push token exists to ask for on this target. */
  | 'UNSUPPORTED'
  /** No EAS project id in the app config; a build-time gap, not a user one. */
  | 'NOT_CONFIGURED'
  /** Expo Go, or Expo's token service failing. Worth retrying. */
  | 'TOKEN_UNAVAILABLE'
  | CommonErrorCode;

export type PushServiceError = ServiceError<PushErrorCode>;
export type PushResult<T> = ServiceResult<T, PushErrorCode>;

/**
 * The Android channel a notification arrives on.
 *
 * Android drops a notification with no channel, and the channel's importance —
 * not the payload — is what decides whether it makes a sound or appears as a
 * heads-up banner. It is created at registration time rather than at import,
 * because creating it is a native call and this module is imported on web too.
 */
const ANDROID_CHANNEL_ID = 'default';

/**
 * Which project a token is attributed to.
 *
 * Read from the config rather than hardcoded, and read from both places it can
 * appear: `extra.eas.projectId` is what `app.json` carries after `eas init`,
 * and `Constants.easConfig` is what an EAS build injects. Narrowed by hand
 * because `extra` is an open record — a missing id has to be `null` here rather
 * than an `undefined` that reaches Expo as "attribute this anywhere".
 */
function getProjectId(): string | null {
  const fromExtra = Constants.expoConfig?.extra?.eas?.projectId as unknown;

  if (typeof fromExtra === 'string' && fromExtra) return fromExtra;

  const fromEas = (Constants.easConfig as { projectId?: unknown } | null)?.projectId;

  return typeof fromEas === 'string' && fromEas ? fromEas : null;
}

/**
 * Whether this target can hold a push token at all.
 *
 * Checked before permission is requested, so a simulator never shows a prompt
 * for something it could not have delivered anyway.
 */
export function canReceivePush(): boolean {
  return Platform.OS !== 'web' && Device.isDevice;
}

/**
 * Asks the device for permission to notify, and reports what it said.
 *
 * `getPermissionsAsync` first: on iOS the system prompt is shown once per
 * install and every later `requestPermissionsAsync` resolves silently with the
 * stored answer, so asking for the current state first is what lets a
 * previously granted permission be re-used without a round trip through the OS.
 *
 * iOS `provisional` authorization counts as granted — it delivers quietly to
 * the notification centre, which is delivery, and `granted` is false for it.
 */
export async function requestPushPermission(): Promise<PushResult<null>> {
  if (!canReceivePush()) {
    return fail(
      'UNSUPPORTED',
      Platform.OS === 'web' ? 'errors.push.unsupportedWeb' : 'errors.push.unsupportedSimulator',
    );
  }

  try {
    const current = await Notifications.getPermissionsAsync();
    const settings = current.granted ? current : await Notifications.requestPermissionsAsync();

    const provisional =
      settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;

    if (!settings.granted && !provisional) {
      return fail(
        'PERMISSION_DENIED',
        settings.canAskAgain ? 'errors.push.permissionNeeded' : 'errors.push.permissionDenied',
      );
    }

    return ok(null);
  } catch (cause) {
    // A native module that is missing or a permissions API that throws is the
    // same answer to the caller: this device is not going to produce a token.
    return fail('UNSUPPORTED', 'errors.push.unsupportedDevice', cause);
  }
}

/**
 * The Expo push token for this device, or the reason there isn't one.
 *
 * Permission is requested first because the token request needs it; the
 * Android channel is created before the token rather than after, so a
 * notification that arrives immediately after registration has somewhere to
 * land.
 */
export async function getExpoPushToken(): Promise<PushResult<string>> {
  const permission = await requestPushPermission();

  if (permission.error) return { data: null, error: permission.error };

  const projectId = getProjectId();

  if (!projectId) return fail('NOT_CONFIGURED', 'errors.push.notConfigured');

  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
        name: 'Default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const token = await Notifications.getExpoPushTokenAsync({ projectId });

    if (!token.data) return fail('TOKEN_UNAVAILABLE', 'errors.push.tokenUnavailable');

    return ok(token.data);
  } catch (cause) {
    // Expo Go on SDK 53+ throws here rather than returning: remote push was
    // removed from it, so this is the expected result of the only build most
    // of this project's development happens in.
    return fail('TOKEN_UNAVAILABLE', 'errors.push.tokenUnavailable', cause);
  }
}

/**
 * Writes a token onto the caller's own profile row.
 *
 * Kept in this file rather than folded into `familyService.updateOwnProfile`,
 * which offers the four fields a member's *identity* is made of. A push token
 * is not identity — it is the address of one device, it changes without anyone
 * editing anything, and it is the only profile column with a server-side write
 * guard of its own (`guard_profile_columns` rejects a token written onto
 * somebody else's row, which an admin's UPDATE policy would otherwise permit).
 *
 * The row is not read back. Nothing renders a push token, and `AuthContext`'s
 * profile is not worth invalidating for a column no screen displays.
 */
async function writePushToken(token: string | null): Promise<PushResult<null>> {
  return guarded(async () => {
    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) return fail('NOT_AUTHENTICATED', 'errors.notAuthenticated');

    const { error } = await supabase
      .from('profiles')
      .update({ push_token: token })
      .eq('id', auth.user.id);

    if (error) {
      return fail(
        /permission denied|violates row-level security/i.test(error.message ?? '')
          ? 'NOT_AUTHENTICATED'
          : 'UNKNOWN',
        token === null ? 'errors.push.clearFailed' : 'errors.push.saveFailed',
        error,
      );
    }

    return ok(null);
  });
}

/**
 * Turning notifications on: get a token, then store it.
 *
 * Both halves have to succeed for the switch to stay on — a token Expo issued
 * but the database never stored would leave the UI claiming a registration that
 * no sender could ever find. The token is returned so a caller can log or
 * display it; the switch ignores it.
 */
export async function registerForPushNotifications(): Promise<PushResult<string>> {
  const token = await getExpoPushToken();

  if (token.error) return { data: null, error: token.error };

  const stored = await writePushToken(token.data);

  if (stored.error) return { data: null, error: stored.error };

  return ok(token.data);
}

/**
 * Turning notifications off: forget the token.
 *
 * NULL rather than an empty string, because "not registered" is the column's
 * default and a sender's test is `push_token is not null`. The OS permission is
 * deliberately left alone — it is not the app's to revoke, and someone who
 * turns the switch back on should not face the prompt again.
 */
export async function unregisterFromPushNotifications(): Promise<PushResult<null>> {
  return writePushToken(null);
}
