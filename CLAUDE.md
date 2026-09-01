# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

**Four files carry the load; read them before changing behaviour.**
`src/navigation/RootNavigator.tsx` decides which screens exist at all,
`src/context/FamilyContext.tsx` is the only source of family data,
`src/services/result.ts` defines the return type every network call shares, and
`src/theme/colors.ts` is where every colour comes from. The recurring principle
underneath most rules below: **nothing is rendered that the schema cannot
supply** — no fixtures, no placeholder rows, no fake counts.

## Commands

```bash
npm start          # Metro dev server (QR for Expo Go, then w / a / i)
npm run web        # start straight into the browser target
npm run typecheck  # tsc --noEmit
npm run lint       # expo lint (ESLint flat config)
npm run auth:config  # read the live project's auth config; writes need explicit flags
```

Run `npm run typecheck && npm run lint` before considering work done — both are currently clean and should stay that way.

**There is no `.env`, and the app does not need one.** `src/services/supabase.ts` reads
`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` and falls back to the live project's
URL and publishable key written into that file, so a fresh clone runs against the real backend
with no setup. Both are safe to embed: the publishable key only ever reaches the database as
`anon`, and every policy is scoped `to authenticated`, so `anon` is granted nothing. `EXPO_PUBLIC_*`
values are **inlined at bundle time** — adding a `.env` means restarting Metro, not just reloading.

Do not confuse those with `SUPABASE_ACCESS_TOKEN`, which the **app never reads**. It is a personal
access token for `npx supabase` and `npm run auth:config`, and every CLI command below needs it
exported because there is no stored login.

There is **no test runner installed** (no jest/jest-expo, no test files). Do not invent a test command; if tests are wanted, set them up per https://docs.expo.dev/develop/unit-testing/ first.

No Xcode or Android Studio is installed on this machine, so `npm run ios` / `npm run android` cannot open a simulator. Verify on a physical device via Expo Go, in the browser, or by bundling headlessly:

```bash
npx expo export --platform ios --output-dir /tmp/export-check   # proves the app compiles
```

`npm run web` server-renders the current route, so `curl -s http://localhost:8081` returns real HTML — grep it for copy and for computed colours (RN Web emits `rgba(34,192,99,1.00)`, not `#22C063`) to confirm a UI change landed without opening a browser.

A dev server is often already running on 8081. `npx expo start` then asks "Use port 8082 instead?" and **dies immediately when run non-interactively** ("Input is required, but 'npx expo' is in non-interactive mode") — so a backgrounded start looks like a crash. Check `curl -s -o /dev/null -w '%{http_code}' http://localhost:8081` and reuse the running server instead of starting a second one.

**Do not grep the dev server's bundle to prove a string landed.** `curl
'http://localhost:8081/node_modules/expo-router/entry.bundle?platform=ios'` returns ~6 MB that
does **not** contain app copy — Metro splits modules lazily, so a grep for text you just added
returns zero whether the change works or not, which reads as a bug that is not there. Use
`npx expo export` and search the emitted `.hbc` instead — but search it correctly, because two
things will otherwise report a change that landed as missing:

- **`strings` only extracts ASCII runs**, so every non-English catalog reads as absent.
- **Hermes splits its string table by encoding.** ASCII strings are stored UTF-8; anything with
  one non-ASCII character — `’`, `á`, Cyrillic, Arabic, kana, even the `·` in a badge label — is
  stored **UTF-16LE**. Searching UTF-8 alone finds `Upgrade to FamApp Gold` and misses
  `FamApp Gold’a geç`, which is a false negative on nine catalogs out of ten.

So the check has to try both encodings:

```bash
python3 -c "
import glob, pathlib, sys
b = pathlib.Path(glob.glob(sys.argv[1])[0]).read_bytes()
n = sys.argv[2]
print(b.count(n.encode('utf-8')) or b.count(n.encode('utf-16-le')))
" '/tmp/export-check/_expo/static/js/ios/entry-*.hbc' 'FamApp Gold’a geç'
```

**A backgrounded `npx expo start` prints no QR code** — the interactive terminal UI is what draws
it. The URL is `exp://<lan-ip>:8081` (`ipconfig getifaddr en0`), and `qrcode-terminal` is already
in `node_modules` (Expo depends on it), so it can be rendered without adding anything:

```bash
node -e "require('qrcode-terminal').generate('exp://192.168.1.5:8081', {small:true}, console.log)"
```

**Auth broke that trick for server-rendered markup.** `RootNavigator` renders a spinner until the stored session *and* the stored preferences resolve, and on the server neither ever does, so every route now server-renders an empty shell (~18KB, no app copy). Verify UI in a browser, or temporarily short-circuit the `isLoading || !isHydrated` guard in `RootNavigator` — both halves, since either one alone still holds the splash. The alternative — rendering the signed-out tree during SSR — was rejected because it flashes the welcome screen at every already-signed-in web user.

### Supabase CLI

The CLI is **not installed globally** — every command is `npx supabase`, and all of them need
`SUPABASE_ACCESS_TOKEN` exported (there is no stored login). The project is already linked to
`mdgjzuczzjxlbivcbdnp`.

```bash
npx supabase db push --dry-run                 # review pending migrations
npx supabase db push                           # apply them to the LIVE project
npx supabase db query --linked --output csv "select 1"   # ad-hoc SQL against the remote
npx supabase db advisors --linked --type security        # Supabase's own RLS/privilege linter
npx supabase gen types typescript --linked --schema public > src/data/database.types.ts
```

**Docker is not running on this machine**, so `supabase start` / `db reset` / local Edge
Function serving are unavailable — everything runs against the linked remote, and `db push` is
not a dry run of anything. `db advisors` is worth running after any migration that touches
grants or policies. For migration work without touching the live project, a throwaway
Postgres (`/opt/homebrew/opt/postgresql@14/bin`) plus stubs for `auth`/`storage`/`vault`/`cron`
will execute the migrations offline, but it cannot reproduce Supabase's own guards — see the
backend gotchas below for two that only appear on the hosted project.

**Never run `npm run reset-project`.** It is a leftover from the Expo starter template and moves `src/` and `scripts/` into `example/`, destroying the app.

## Architecture

Expo SDK 54 · React Native 0.81 · React 19.1 · expo-router 6 (file-based) · TypeScript strict.

**Routes live in `src/app/`, not `app/`.** The stock README says `app/` — it is wrong for this project. Path aliases (`tsconfig.json`): `@/*` → `src/*`, `@/assets/*` → `assets/*`.

**zsh treats the parentheses in `src/app/(tabs)/` as a glob.** `cat src/app/(tabs)/index.tsx` fails on a file that plainly exists — usually `zsh: no matches found`, sometimes as a literal `cat: …: No such file or directory`, depending on how the command reaches the shell. Both read as the file having moved. Quote the path or escape the parens: `cat './src/app/(tabs)/index.tsx'`. Every tab screen sits behind this.

Navigation is one root `Stack` with five tabs (Home, Chat, Map, Tasks, Profile). `src/app/_layout.tsx` is only the shell — providers and theme; **which screens exist is decided by `src/navigation/RootNavigator.tsx`**, which reads `useAuth()` plus `usePreferences()` and mounts one of four mutually exclusive branches with `Stack.Protected`:

| state | mounted |
| --- | --- |
| no session | `index` (Welcome), `sign-in`, `sign-up` |
| session, not `inApp` | `create-family`, `join-family` |
| `inApp`, no avatar | `avatar-builder` |
| `inApp` + avatar | `(tabs)`, `edit-avatar`, `edit-profile`, `manage-members`, `add-family`, `premium` |

`inApp` is `profile.family_id || preferences.familySetupSkippedFor === session.user.id` — **a family is not required to use the app.** "Skip for now" on `create-family` stores that preference and the app runs solo: every list is already empty-state driven, so a family of none needs nothing faked. A real `family_id` outranks it, so joining later is unaffected.

That preference stores a **user id, not a boolean**, and is compared against the live session. AsyncStorage outlives the session, so a flag would carry one account's choice onto the next person to sign in on the same device — skipping family setup for someone who never asked. Matching on the id makes it self-expiring; signing out needs no cleanup.

Family setup is **not** mounted alongside the tabs — a screen cannot sit in two `Stack.Protected` groups. So getting a family from inside the app is a **second screen**, `add-family`, mounted in the tabs branch and pushed from Profile's "Create or join a family" row. It is not a variant of `create-family` and must not be merged back into it:

| | `create-family` (+ `join-family`) | `add-family` |
| --- | --- | --- |
| when | onboarding, before the app | already inside the app, solo |
| branch | `isSignedIn && !inApp` — its root | `inApp && hasAvatar`, pushed |
| exits | Skip for now · Sign out · the peer screen | back to Profile |
| identity | asked from blank | seeded from the profile row |
| on success | flips a guard, which navigates | **navigates itself** — no guard changes |

That last row is the exception to the rule below: `add-family` is the one family write that calls `goBack()`, because the user is already `inApp` with an avatar and setting `family_id` moves no guard. Everywhere else nothing calls `router.replace` to change branch — flipping a guard is what moves the user, so `signOut()` and `refreshProfile()` after joining a family are the navigation. Redirect-inside-an-effect is deprecated in expo-router; don't reintroduce it.

Because a guard now reads a stored preference, `RootNavigator` waits on `isHydrated` as well as auth's `isLoading` — `familySetupSkippedFor` defaults to null, so rendering before the read lands would flash family setup at someone who already skipped it. Note the split: `PreferencesProvider` still renders its children ungated (see below); it is `RootNavigator` that holds the splash.

### Layers that must stay separate

1. **`src/theme/`** — colour/spacing/typography/radius/shadow/**motion** tokens, defined per scheme. `motion.ts` is the newest and the same argument as the rest: a duration typed at a call site is a number nothing keeps in step with the twenty other places that meant the same thing. It holds five durations (`press` `fast` `base` `panel` `exit`), two spring presets, the distance content travels while it fades, and the two thresholds a sheet's drag is released against.
2. **`src/i18n/`** — the ten catalogs and the one `translate` function. `translations/en.ts` is the source of truth for the key set; the other nine are typed against it. Imported by everything, imports nothing but `react-native`'s `Platform`.
3. **`src/data/`** — `types.ts` (domain contracts), `format.ts` / `geo.ts` / `activity.ts` / `avatar.ts` / `places.ts` / `premium.ts` (pure derivations: labels, map projection and Haversine distance, the Home feed, memoji seeds, who is standing at a saved place, and whether the family's Gold grant is live), and `database.types.ts`, which is **generated** by `supabase gen types` — never hand-edit it; regenerate after a migration. There are **no fixtures**; `mock.ts` was deleted. Everything here that produces *copy* takes the `Translator` as its first argument (`relativeTime(i18n, iso)`), which is what keeps the layer a pure derivation instead of a reader of ambient state — see the i18n section.
4. **`src/services/`** — every network call, and the one sensor read. `supabase.ts` owns the one client; `authService`, `familyService`, `chatService`, `chatMediaService`, `taskService`, `locationService`, `placesService` and `purchaseService` wrap it; `result.ts` holds the shared return type. `chatMediaService` is the only one that talks to **Storage** rather than PostgREST, and the only one that also reaches a picker — the same boundary argument that keeps `getDevicePosition()` in `locationService`. The single non-network member is `locationService.getDevicePosition()`, which reads the GPS — it lives here because it is the same boundary as the rest of the file (an outside world that fails, wrapped in a `ServiceResult` that never throws), not because `services/` is a junk drawer.
5. **`src/context/` + `src/hooks/`** — app-wide state (`AuthProvider`/`useAuth`, `FamilyProvider`/`useFamily`, `PreferencesProvider`/`usePreferences`, `LocationProvider`/`useLocation`) and the theme hooks. Provider order in `src/app/_layout.tsx` is a dependency chain, not a preference: preferences → auth → family → location, each reading the ones above it.
6. **`src/navigation/`** — `RootNavigator.tsx` only: which screens exist for which auth state.
7. **`src/components/`** — `ui/` holds generic primitives; sibling folders (`home/`, `chat/`, `map/`, `tasks/`, `family/`, `settings/`, `premium/`) hold feature-specific composites.

**Screens never import `supabase` directly.** They call a function in `src/services/`, which is
what keeps error mapping and the RPC-only membership rules in one place.

**Colours are never hardcoded.** Call `useTheme()` (`src/hooks/use-theme.ts`) and read from `colors.*`; it resolves the active scheme into `ThemeColors`. The scheme is the stored `appearance` preference (`system` `light` `dark`) falling back to the OS — which is why `PreferencesProvider` is the outermost provider in `src/app/_layout.tsx` and the layout is split into `RootLayout` (provider only) and `AppShell` (everything that calls a theme hook). Adding a colour means adding the token to *both* `Palette.light` and `Palette.dark` in `src/theme/colors.ts` — they are kept structurally identical and `ColorToken` is derived from their intersection. Same for spacing/radius: use `Spacing`/`Radius`, not raw numbers.

`MemberColors` is deliberately scheme-independent so a family member keeps one identity colour (map pin, activity dot, avatar *fallback*) in light and dark mode. `Avatar` takes a `colorIndex` into that list, not a colour.

**Brand rules the palette encodes** (`src/theme/colors.ts`) — respect the split rather than picking whichever token looks right:

| Token | Light value | Used for |
| --- | --- | --- |
| `primary` | `#22C063` | filled buttons, active tab, FAB, own chat bubble, selected states |
| `accent` | `#0366FF` | links, highlights, secondary actions **only** — never a filled primary CTA |
| `background` | `#FFFFFF` | app canvas — pure white, same value as `surface` |
| `text` / `textSecondary` | `#1D1F1F` / `#161717` | headings + body / secondary copy and icons |

`textTertiary` exists because the two brand text colours are both near-black — it carries captions and muted metadata. `success`/`successSoft` alias the brand green and `info`/`infoSoft` alias the accent blue, so blue and green each have exactly one source. Style stays minimal: no decorative illustrations, `Shadow.card` is deliberately faint.

**The one gradient in the app is a wash, and it only ever runs pastel → canvas.** Each of the four status hues carries a third stop, `${tone}Wash`, whose whole job is to be the far end of a `GradientSurface`: `primaryWash` (`#F6FCF8`) is a breath off white, and the dark-mode washes settle toward `background` instead. Because the fade always ends *at* the page, the result reads as tinted paper rather than as the decorative gradients the brand rules still forbid — two saturated stops would be exactly that, and are not what these tokens are for. There are five such surfaces and no more: the Home banner, the Profile banner (both `primary`), `LiveStatusPill`, which passes its own status tone straight through, and the two halves of the paywall — `PremiumBanner` on Home and the hero on `premium.tsx`, both `warning`. **`warning` is the gold**, and it is the whole of FamApp Gold's colour: the banner, the Profile row's badge, the benefit wells and the selected plan's border all read the one amber the palette already had (`#C77C1A`), so the paywall adds no token. It is deliberately not `primary` — green is what the *family* does, and a promo dressed as one reads as something they did. The CTA is the exception and is green, because buying is the action. The angle is diagonal on purpose; a horizontal sweep across a full-width banner reads as a loading bar. **Everything under a banner stays white** — that contrast is what makes it read as the top of the screen.

**The light canvas is white, so a card cannot separate itself by fill** — `background`, `surface` and `surfaceElevated` are all `#FFFFFF`. Light-mode depth is carried by `border` (`#E1E3E3`) and `separator` (`#ECEDED`) plus `Shadow.card`, which is why those lines are darker than a typical off-white theme would need. Do not "fix" a card that looks flat by tinting its fill: strengthen the line, or leave it. Greys only ever step *down* from white — `surfaceMuted` (`#F1F2F2`) is the recessed fill for inputs, icon wells, chips and pressed rows, never a raised one. Dark mode keeps the opposite convention, stepping surfaces up from the canvas, and `mapCanvas` stays grey in both — it is what shows through before a map tile does, so the map reads as a distinct plane behind white chrome even while it is loading.

Every string goes through the `Text` primitive with a `variant` + `color` token — no bare RN `Text`, no inline `fontSize`. Import primitives from the barrel (`@/components/ui`), not their individual files. `Text` is also the one place right-to-left is handled (see i18n below), which is a second reason nothing may reach for RN's own.

The primitives take closed prop vocabularies rather than free-form style; reach for an existing value before adding one:

| Primitive | Props |
| --- | --- |
| `Text` | `variant`: `display` `title` `heading` `subheading` `body` `bodyStrong` `caption` `captionStrong` `label` · `color`: any `ColorToken` (default `text`) · `center` |
| `Button` | `variant`: `primary` `secondary` `ghost` `danger` · `size`: `md` `lg` (default `lg`) · `loading` `disabled` `leading` |
| `Badge` | `tone`: `neutral` `primary` `success` `warning` `danger` `info` — each maps to a `*Soft` background + solid foreground pair in `badge.tsx` |
| `Avatar` | `initials` + `colorIndex` into `MemberColors` (the fallback), `avatar` (an `AvatarConfig`), `size`, `online`, `ring` |
| `TextField` | `label` `value` `onChangeText` · `error` (reddens the border) · `secureTextEntry` `keyboardType` `autoCapitalize` `autoComplete` `returnKeyType` `editable` `multiline` `maxLength` |
| `ListRow` | `icon` `label` · `description` `value` `onPress` · `tone`: `text` `danger` · `badge` + `badgeTone` · `showChevron` `disabled` `isLast` |
| `SwitchRow` | the same row for a setting that toggles: `icon` `label` `description` `value` `onValueChange` `disabled` `busy` `isLast` |
| `Segmented` | `options` (2–4 `{ value, label }`) `value` (nullable) `onChange` `label` `disabled` |
| `Sheet` | bottom panel: `visible` `title` `showTitle` `description` `dismissible` `onClose` — see the modal rule below |
| `PressableScale` | every touchable that is not one of the above: all of `Pressable`'s props except a function `style`, plus `scaleTo`, `feedback`, and `highlightColor` + `highlightRadius` for the row treatment below |
| `GradientSurface` | pastel wash for a hero surface: `tone` (`primary` `warning` `danger` `info`) `style` |
| `Card` | the grouped-content surface: `onPress` (supplying it makes the card pressable) · `padded` · `style` — a plain `ViewStyle`, **not** a `StyleProp`, so merge with a spread and never an array |
| `Section` | a titled block: `title` · `actionLabel` + `onActionPress` |

`Button`'s `danger` is a **soft** fill (`dangerSoft` background, `danger` label), not solid red — the solid token lightens in dark mode and carries white text badly. It is the confirm action of a destructive dialog, never a page's main CTA.

Destructive actions are confirmed through `ConfirmDialog` (`visible` `title` `message` `confirmLabel` `cancelLabel` `tone` `icon` `loading` `error` `onConfirm` `onCancel`), never RN's `Alert` — `Alert` does not exist on web, and the write stays *inside* the dialog so a failure reports itself in place instead of dismissing.

`Sheet` (`visible` `title` `showTitle` `description` `dismissible` `contentKey` `onClose`) is the bottom panel — the chat "+" menu and the task form. It stays separate from `ConfirmDialog` on purpose: that one is a centred question with two answers, this one is a surface. **Never present one `Modal` while dismissing another in the same frame** — it is unreliable on iOS, which is why Chat drives *one* `Sheet` through a `'none' | 'actions' | 'message' | 'task' | 'photo'` state and swaps its children rather than handing off to a second sheet. That is also why `TaskComposerForm` (content) and `TaskComposer` (content in a `Sheet`) are separate exports.

**Both overlays drive their own transition, and neither uses `animationType`.**
RN's is a property of the *window*, so `slide` carries the scrim up with the panel like a
card with a grey backing, and `fade` brings a dialog and its scrim in as one flat layer.
Separating them is the whole difference between a surface appearing and a surface arriving:
`Sheet` fades the backdrop where it stands while the panel travels its own measured height
(`onLayout`, so a short menu does not slide as far as a full form), and `ConfirmDialog` fades
the scrim while the card scales up out of it. Both keep the `Modal` mounted one animation
past `visible` — a `mounted` state the exit's completion clears — because unmounting on the
prop cuts the exit off at its first frame. Three consequences worth knowing: the backdrop is
now a **sibling** of the panel rather than its parent, so the press-swallowing wrapper both
used to need is gone; the overshoot on the dialog's card is shaped in the *interpolation*
(`[0, 0.7, 1] → [0.94, 1.012, 1]`) rather than in the easing, since a back curve on the
timing would push the opacity above 1 as well; and `useNativeDriver` is off on web, where
there is no native animated module to drive.

**A sheet is dismissed by dragging its handle, and only its handle.** The whole panel is the
more generous target and is the wrong one: every sheet in this app holds either a scroll view
or a text field, and a `PanResponder` over those competes for the same downward drag. The
handle is the one strip that owns nothing else. Past `Motion.dismissDistance` (96 px) or
`Motion.dismissVelocity` on release it calls `onClose`; short of that it springs home. An
upward drag is refused rather than inverted — there is nothing above the panel to reveal, so
following the finger would only detach it — and the drag is added to the slide with
`Animated.add`, which is what lets a released gesture hand straight off to the exit. It
carries no accessibility role, because a screen reader cannot drag; dismissal is announced on
the backdrop, which is reachable.

**`contentKey` is how a sheet that swaps its children says so.** Chat runs a menu, a message
menu, a task form and a photo confirmation through one panel and the Map's runs five modes;
naming the current one lets the incoming content fade and lift into place (`Motion.shift`)
instead of replacing the outgoing between two frames. Only the *arriving* half is animated —
holding the old children alive to cross-fade them would mean rendering a form that has
already been told to reset.

`Sheet` also owns **the app's only keyboard avoidance inside a modal** — `behavior: 'padding'` on iOS and `'height'` on Android, the second because an RN `Modal` is its own window and does not inherit the activity's `adjustResize`, so without it a focused field at the foot of a sheet sits under the keys. Content a sheet holds must therefore **not** wrap itself in a second `KeyboardAvoidingView`: nested, the inset applies twice and lifts the panel clear off the keyboard it was avoiding. What content owes instead is a scroll view that *yields* — `flexShrink: 1` against the panel's `maxHeight: '100%'` — so the keyboard shrinks the scrolling middle and a footer row stays on screen rather than being pushed off the bottom.

**A bare `Pressable` is no longer the default touchable — `PressableScale` is.** It bundles the two halves of a press: `usePressScale()` (`src/hooks/use-press-scale.ts`) dips the surface to 0.97 scale / 0.9 opacity on `Animated`, and one haptic fires on `onPress`. Firing on press rather than press-in is deliberate — a finger that slides off the target must not leave a buzz behind for something that never happened. Every touchable in the app goes through it — `Button`, `Card`, `Segmented`, `ListRow`, `ActionRow`, `NavHeader`'s two controls, `Section`'s action, `MemberRow`'s remove, the map drawer's rows and handle, the place and assignee chips, every colour swatch, the auth screens' footer links, `LiveStatusPill`, `PresenceTile`, the Tasks FAB and filter chips, both Locate buttons, the chat composer's two controls and the memoji Shuffle — and each has dropped its own `pressed && styles.pressed`. **The animation *is* the pressed state**, so a component that re-adds a static pressed style is fighting it. **How far a surface dips is a function of how big it is**, and the sizes are a vocabulary rather than a taste: `0.97` is the default a button takes, `0.98` a card (the same 3% is a visibly larger movement on something full-width), `0.94` a chip or a short text action, `0.9` a 32–40pt circle, and `0.99` a full-width row. A control that keeps the default at the wrong size either fails to register or looks like the list flinched.

**A row is not a button, and takes the row treatment instead.** Passing `highlightColor` fades a recess in behind the content while the finger is down — the same `surfaceMuted` fill these rows always switched on and off instantly, now with the 90ms that makes it read as a response rather than a flicker — and it also softens the dip to `0.99` and drops the dimming, since a recess and a fade-out say the same thing twice. `ListRow`, `ActionRow` and the map drawer's roster rows are the three that take it; `highlightRadius` matches the row's own corner where it has one. The layer is drawn *behind* the children (absolutely positioned, so it takes no layout) rather than over them, because an overlay washes out the label it is meant to be under.

The one constraint: `style` cannot be the `({ pressed }) => …` form, because `Animated` cannot look inside a function for its nodes. Anything a caller must be able to override (a `disabled` opacity) goes *last* in that array, after the animated style.

**Haptics are a vocabulary, not raw `expo-haptics` calls.** `useHaptics()` (`src/hooks/use-haptics.ts`) returns one function over six named effects — `tap` (rows, chips, secondary buttons), `press` (a filled CTA, the FAB, a forced location write), `select` (moving within a set — a segment, a filter, a colour swatch, and a `SwitchRow`, which is a move between the two states of one), `success` (a task ticked off), `warning` (confirming something destructive), `error` (a write came back refused, which `ConfirmDialog` fires the moment it has an error to render). Pick by what the action *means*; the pattern behind a name is then one edit. It is a no-op off iOS/Android, and every call is fire-and-forget, so a device with haptics switched off can never turn a working button into a crash. **Feedback belongs to the write, not the control**: each of a task's writes has exactly one owner — `TaskStatusActions` fires from the button's own handler (`success` for finishing, `select` for starting, `tap` for either undo) and `TaskCard` fires `success` for the swipe path — which is what stops a path buzzing twice. `SwipeToComplete` only adds a `select` detent as the finger crosses the threshold, since the track's colour is the one thing a thumb is covering.

**`Segmented`'s selection is one view that slides, not a background switched on and off.**
Two segments changing colour in the same frame says a choice was *replaced*; one thumb
travelling says the same choice *moved*, which is what happened — and it is the only way the
control can show which way the selection went. The geometry is measured rather than assumed:
the track reports its width through `onLayout` and the thumb's width is what is left after
the padding and the gaps are taken out (`(inner - gap × (n-1)) / n`), so the maths holds for
two options or four and for whatever a translated label does to the row. The first measured
layout *places* the thumb rather than animating to it — otherwise it slides in from the left
edge every time a screen mounts already holding a selection — and a null value fades it out
where it stands instead of sliding it to index 0 on its way to nowhere.

**Empty is typeset as an answer, not a footnote.** `EmptyState`'s title takes `subheading` in
the full text colour, because "No tasks yet" is what the screen has to say rather than a
remark about the absence of something; the description stays `textTertiary` and is held to a
320px measure so the block reads as a centred column instead of one sentence stretched across
a tablet. The mark sits in a 56pt well with the gap above the title closed up, which is what
groups the three elements into one thing to look at rather than three evenly spaced lines.

**Back is never a bare `router.back()`.** Use `useSafeBack(fallback?)` (`src/hooks/use-safe-back.ts`), which `NavHeader` already does — pass it `backFallback`. On web every route is reachable by URL, so even a normally-pushed screen can be the first one the stack ever had.

**But `canGoBack()` is not a test of "does this screen have a parent".** It reads the root container, which in a `Stack.Protected` app can still report true for a branch the guards have since swapped away — and `back()` then dispatches GO_BACK at unmounted screens and silently does nothing, which is the dead-chevron bug. So the rule is by *how the screen is reached*, not by asking at runtime:

- **Pushed from a screen in the same branch** (`sign-in`, `sign-up`, `edit-profile`, `edit-avatar`, `manage-members`) — a chevron, plus `backFallback` for the direct-URL case.
- **First screen of a `Stack.Protected` branch, or a peer reached only by `replace`** (`create-family`, `join-family`, `avatar-builder`) — `showBack={false}`, always. There is no parent to pop to, so movement is the explicit link to the peer, the forward action, or **Sign out**, which is what "back" means on a setup screen and takes the trailing action slot on both family-setup screens.

The same file exports `useIsMounted()`; every `setState` or navigation *past an await* is guarded with it, because a successful write is usually what unmounts the screen that made it.

A trailing text action on a header or a section header is always `actionLabel` + `onActionPress` (`NavHeader` adds `actionDisabled`), rendered in `accent` — a header action is never the filled CTA. Reuse that pair rather than dropping a `Pressable` into the header row.

Each `Typography` variant hardcodes a `lineHeight` because RN derives none — adding a variant means adding both. Icons are **Ionicons** from `@expo/vector-icons` throughout — it is the only set imported anywhere in `src/`; don't introduce a second family.

### Language

**Ten languages, one function, no dependency.** `src/i18n/` holds `translations/en.ts` — the source
of truth for the key set — plus `tr` `es` `fr` `de` `it` `pt` `ru` `ar` `ja`, each typed as
`Translations`, which is *derived from* `en`. So adding a string is: add it to `en`, then fix nine
type errors. There is no i18n package and no `expo-localization`: Hermes ships full ICU on iOS and
Android, so `Intl.DateTimeFormat().resolvedOptions().locale` (and `navigator.language` on web)
answers the device question in a few lines, and `Intl.PluralRules` does the plural selection.

Keys are **flat and dotted** (`profile.editAvatar`), not nested — one lookup, and a key union
TypeScript can print in an error. A value is either a string or a `PluralForms` object
(`{ one, other }`, and `zero`/`two`/`few`/`many` where a language needs them); `other` is required,
because it is the fallback for every category a catalog leaves out. Passing `count` is what selects
between them, so **a countable string must use the object form** — `${n} members` concatenated by
hand is wrong in Russian at 3, in Arabic at 2, and in Turkish always. Placeholders are `{{name}}`
and are substituted verbatim; word order inside a string is the translator's business.

**There is no ambient "current language".** `useTranslation()` (`src/hooks/use-translation.ts`,
shaped after `useTheme`) turns the stored preference into a `Translator` — `{ language, locale,
isRTL, t }` — and that object is passed *explicitly* to anything outside React that produces copy:
`relativeTime(i18n, iso)`, `memberName(i18n, member)`, `dueLabel(i18n, iso)`,
`deriveActivity({ i18n, … })`. A module-level mutable language would have been fewer lines and is
what most i18n packages do, but it would make `data/` read hidden state and quietly break the rule
that it derives rather than depends. `Translator.locale` is also what every `toLocaleDateString` /
`toLocaleTimeString` call now takes: once someone has picked a language by hand the *device* locale
is the wrong answer, and passing it is what stops a Japanese UI printing an English month name.

`ChatDay` carries `date`, not `label`, for the same reason — `chatService.groupByDay` groups rows
without knowing which language they will be read in, and the Chat screen calls `dayLabel(i18n, …)`.

**The stored value is `'system' | Language`, and `system` is resolved on every read**, never written
down as a concrete code: someone who changes their phone's language expects the app to follow
without being told again. It lives in `PreferencesContext` beside `appearance`, which has exactly
the same shape and the same justification — the phone in your hand has a language, the account does
not, and a second device rightly starts from its own default. The picker is `LanguageSheet`
(`src/components/settings/`), opened from Profile's "Language" row: eleven options do not fit a
`Segmented` control, and each has to be shown **in its own script**, with its English name
underneath as the one label someone lost in an unfamiliar alphabet has a chance with. The row's
`value` is the *resolved* language, not the preference — "System" would not tell anyone what they
are reading. There is no Save; storing the choice is what changes the app.

**RTL is text direction, not layout.** Arabic gets `writingDirection: 'rtl'` and right-aligned text
from the `Text` primitive — the only place it is handled, and enough to get bidi punctuation and
embedded Latin runs (an email address, a join code) on the correct side. The mirrored *layout* would
mean `I18nManager.forceRTL`, which only takes effect after a relaunch; a language picker that needs
the app restarted to finish the job is worse than one that leaves the columns where they are.

**Two things stay English on purpose.** The database's own `raise exception` messages
("This family is full (10 of 10 members)") are written server-side and arrive as text with no key —
translating them would mean parsing a sentence for its numbers, and the honest fix is a message-code
column, which is a schema change. And a `system` chat message is written in the *creator's* language
and stored as message text: a `messages` row is a row, not a key, and rewriting one person's chat
line into another person's language would be inventing content the table does not hold.

`npm run typecheck` is the coverage check — a missing key in any catalog is a compile error, not a
string that silently falls back at runtime.

### Prototype status

The Welcome screen (`src/app/index.tsx`) is intentionally down to four things: logo tile, app name, "Get started" (→ `sign-up`) and "I already have an account" (→ `sign-in`). Those two buttons used to be "Create a family" / "Join with a code"; they changed because a family now belongs to an account, so the onboarding routes are not even mounted until there is a session. Feature lists, taglines, stats and legal copy were removed on purpose — do not reintroduce them.

**Every screen reads live Supabase rows. There are no fixtures anywhere.** `src/services/` owns the network: `authService` (sessions), `familyService` (create/join/kick/read/own-profile/rotate-code), `chatService`, `chatMediaService` (chat photos), `taskService`, `locationService`, `placesService` and `purchaseService` (the Gold grant) — all returning a `ServiceResult` from `src/services/result.ts` rather than throwing.

**`FamilyProvider` (`src/context/FamilyContext.tsx`) is the single source for family data**, keyed on `profile.family_id`, and read through `useFamily()`. It holds the family, members, messages, tasks and saved places, plus `getMember(id)`, `refresh()`, `sendMessage()`, the three halves of a photo send (`beginImage()` / `sendImage()` / `discardImage()` — see Chat photos), `setTaskStatus()`, `createTask(NewTask)`, `removeMember()` and the three place writes `savePlace(NewPlace)` / `editPlace()` / `deletePlace()`. Fetching per screen instead would mean the same rows arriving four times and a task ticked on one tab going stale on another. Its loaded value is *stamped* with the family id — the same trick `AuthContext` uses for the profile — so leaving one family and joining another cannot show the old members.

**Empty is a first-class state, not an edge case.** A family of one legitimately has no messages, no tasks and no shared locations, so every list renders `EmptyState` (`@/components/ui`) and every counter reads its real zero. Never substitute a placeholder row, a sample name or a fake count.

**There is exactly one thing in the app rendered before a row backs it, and it is
`ChatMessage.pending`** (`PendingUpload` in `src/data/types.ts`) — the photo bubble that appears
while the upload runs. It is not a hole in the rule above, because the rule exists to stop
*family* data being invented and this is the sender's own action, on their own screen, one second
ahead of the network, drawn from a file that already exists on the device. Three things keep the
exception from widening, and a fourth thing is what it costs. It is set **only** by
`FamilyContext.beginImage` and removed by `sendImage`/`discardImage`, so nothing else can mint one.
It never survives a reload, because nothing writes it down — a pending message the app forgot is
the honest outcome of a send that never finished. It is confined to the **chat stream**: Home's
`deriveActivity` and its latest-message tile both skip a pending message, since "Sami shared a
photo" is a claim about what the family can see and is not true until they can. And the cost is
that every new consumer of `messages` has to decide which of those two it is — the sender's view,
or the record.

**Components hold member *ids*, not member objects**, and the *screen* resolves them via `getMember(id)` before passing a `FamilyMember` down (`ActivityRow` takes `member`, `MessageBubble` takes `sender`, `TaskCard` takes `assignee`). "Is this mine?" is decided by comparing against `user.id` from `useAuth()`.

**Avatars are Tapback memoji, and the seed is the only thing stored.**
`profiles.avatar_config` (jsonb, defaults to `{}`) holds `{ "seed": "…" }`;
`https://tapback.co/api/avatar/{seed}.webp` renders a deterministic 128×128 memoji
for it. Storing the seed rather than a URL keeps today's host and file extension
out of every row. `src/data/avatar.ts` owns the whole vocabulary — `randomAvatarSeed()`,
`avatarImageUrl()` and `parseAvatarConfig()`, which returns null for `{}` and for
any seed outside `[A-Za-z0-9_-]{1,64}`. That null is load-bearing: it is what
`RootNavigator` reads to decide whether the member still owes an avatar, so
"has a profile row" is never "has an avatar".

This is the only network image in the app **on native**, and the only one
anywhere that stands for a person, so it is not allowed to leave a hole. (Web
loads map tiles over the network too, but a missing tile is a grey square, not a
missing member.) `Avatar` renders the initials-on-`MemberColors` circle underneath and swaps
to the memoji on `onLoad`; on `onError` the initials stay for good. The memoji
ships its own circular background (the seed picks that colour too), which is why
nothing is painted behind a loaded one — the member colour would ring it wherever
the two circles disagree. `expo-image` carries it for the disk cache and webp
support; RN's own `Image` has neither. Both picker screens share
`MemojiPicker` (`src/components/family/`), which keeps a *queued* seed prefetched
so "Shuffle" swaps to something already cached instead of blanking the circle.

**Nothing renders a value the schema cannot supply.** `locations` stores coordinates and no place name, so the map card shows coordinates and a relative timestamp — not a geocoded address. There is no battery column, so battery is gone. There is no activity table, so the Home feed is folded from messages and task creations, both of which carry a real `created_at`; "task completed" is absent because `tasks` records *who* but never *when*.

**Device settings are local, and honest about it.** `PreferencesProvider` (`src/context/PreferencesContext.tsx`, read through `usePreferences()`) holds `appearance`, `language`, `notifications`, `locationSharing` and `familySetupSkippedFor` in one AsyncStorage key. There is no settings column and none was added — inventing one to back a switch would be the same mistake as inventing a fixture. (`profiles.push_token` is not a counter-example: it stores the *address of a device*, which the server needs in order to reach it, not the preference itself — whether this phone wants notifications stays in AsyncStorage, and a second device rightly starts from the default.) **The provider deliberately does not gate its own children** — withholding them would leave nothing to render on the server. Gating is `RootNavigator`'s job instead, and only because one guard now reads `familySetupSkippedFor`; a provider that blocked the whole tree would break SSR, whereas a navigator that shows a splash is what already happens for the session. `locationSharing` and `notifications` are the two with a server-side consequence, and **each screen reverts its switch if the write fails** — a flag that claims more privacy, or more delivery, than there is would be worse than no flag at all. Switching location sharing off calls `locationService.clearOwnLocation()`, which **deletes** the caller's `locations` row, because a stale pin left behind would keep showing on everyone's map; it is also the tracker's gate, so switching it off tears down the timer *and* forgets the distance baseline, and switching it back on writes immediately rather than waiting to travel 100 m from a position that no longer exists. Switching notifications on runs `registerForPushNotifications()` — permission, an Expo push token, then that token onto `profiles.push_token`; switching it off clears the column but deliberately leaves the **OS permission alone**, which is not the app's to revoke and would put the prompt back in front of anyone who toggled twice. See the Push notifications section below for the four ways this fails on a device that is working fine.

**Every row on the Profile screen does something**, and the Home screen holds nothing that only looks like it does. The exception, and the only one, is the "FamApp Gold" row that leads the Account group — it opens a paywall that sells nothing (see Premium below). A `ListRow` carries the gold marker through `badge` + `badgeTone`, which is a separate slot from `value`: `value` is a setting's current answer in caption text, a badge is a state. The "Language" row under Preferences is the newest of them: it opens `LanguageSheet` and shows the language actually in use — see the Language section. "Safe zones", "Permissions", "Privacy" and "Help & support" were removed from Profile rather than left as chrome; Home's "Shortcuts" strip went the same way — two of its five tiles ("Check in", "Calendar") had no `onPress` at all, and the other three only re-entered tabs the tab bar already reaches. Do not reintroduce it. The Map lost its "Search places" pill, its layers button and the "Directions" button on the detail card for the same reason: none had an `onPress`, and there is no geocoder, no second layer and no routing behind any of them. Its controls are the pins, "Locate me", "Save a place" and the peeking drawer (`MemberDrawer`), plus a status line that appears **only** when sharing cannot work (no family, switch off, or the last fix failed) — a status that is always on screen is chrome again. The drawer collapsed *is* the old detail card — the selected member, their coordinates and how old the row is; opened it is the roster, and tapping a row re-centres the map camera on that person and haloes their pin. A member with no `locations` row keeps their line, says "Not sharing location" and cannot be tapped, because there is nothing to centre on. "Manage members" is `disabled` for a member who is not an admin, with the reason in its `description` — the real boundary is `remove_member`'s, and a dimmed row explains it better than a refusal after the fact. With no family that row is replaced (not disabled) by "Create or join a family", which is the only way out of solo mode and pushes `add-family` (never the onboarding `create-family` — see the table above). Both branch on `profile.family_id`, never on `family` from `useFamily()` — that is also null while a real family is loading, and the row must not flicker "you have no family".

**Home is a bento grid of four blocks, and every one of them is rows.** `LiveStatusPill` is a single slot filled by whichever row is most worth acting on — an open task past or at its `expires_at`, then the newest `locations` row if it was written within one tracking interval, then what the family is at all — and it navigates to the tab that owns that row. Under it, `PresenceTile` is the wide tile (a chip per member: memoji, presence ring, `relativeTime` of their row or "No location", plus the "Locate" trigger, which is `useLocation().syncNow()`, the same forced write the Map's button performs), then two `MiniTile`s for the next open task and the last message, then the `deriveActivity` feed. The old four-count `OverviewCard` grid was deleted, not moved: each count now lives inside the tile that can act on it. The pill shows "Loading your family…" while `isLoading`, because every count under it would otherwise flash a real-looking zero.

**A presence ring is not the presence dot.** `Avatar`'s `online` dot means the pin is fresh enough to trust (`ONLINE_WINDOW_MS`, 5 min); its `ring` means that member's device is still reporting at all — `isRecentlySynced(location)` in `src/data/format.ts`, one tracking interval (`SYNCED_WINDOW_MS`, 12 min, deliberately a literal so `data/` does not import the provider whose cadence it mirrors). Callers pass the derivation, never a colour; the ring is `colors.success`.

**A task has two actions, and every surface shares them.** `TaskStatusActions` (`src/components/tasks/task-status-actions.tsx`) is the pair of buttons — "In progress" and "Done" — rendered by *both* `TaskCard` on the Tasks tab and `TaskMessageCard` in the chat stream, so the same press means the same write wherever a task is being looked at. Pressing the state a task is already in clears it back to `pending`, which is what makes the pair a toggle rather than a one-way trip; `expired` is offered nothing, because it is the retention sweep's verdict rather than a state anyone chose. The single checkbox both cards used to carry is **gone**: it could only ever say two of the three states, and no version of it could show that somebody had picked a task up.

**Who may press them is a UI rule and nothing more.** `canActOnTask(task, userId)` allows the assignee, and allows anyone when `assigneeId` is null — an unassigned task is the pool. But `tasks: family updates` is deliberately family-wide, its own migration comment reading "any member may claim, hand over or complete any task in their family", so a non-assignee is stopped **in the client and nowhere else**. Do not describe this as enforcement, and do not build anything on top of it that assumes it holds; making it real means narrowing that policy in a migration. A locked card dims its buttons and names whose task it is rather than hiding them, because a control that vanishes explains nothing.

**Swiping survives as the shortcut it always was.** `SwipeToComplete` (`src/components/tasks/`) wraps `TaskCard` and pulls it right to reveal a `successSoft` track; past the threshold on release it writes `completed` — the same write the "Done" button makes. It is built on RN's own responder props plus `Animated` — there is no gesture library in this project, and `Animated` is the whole of its animation layer — and it claims the gesture only for a clearly sideways, rightward drag so the task list still scrolls. It is offered only on an open task whose write is not already in flight **and which `canActOnTask` allows this viewer to move**, so a pull can neither un-do a finished task nor finish somebody else's; the card springs back rather than vanishing, because whether it moves to the Completed section is the database's answer.

**A solo user still sees themselves.** With no family the roster is empty, so `FamilyProvider` builds `currentMember` from the profile row via `toFamilyMember(profile, null)` rather than leaving a `?` circle on Home and Profile. Only in that case: once a family exists its roster is the authority, and carries `isAdmin` and a location a lone profile row cannot. A skipper's `display_name` is null until they set one in Edit profile, so they read as "Unnamed member" — that is honest, not a bug to paper over with the email local part.

**Chat is the primary entry point for creating a task, and the schema already had the link.** The composer's leading "+" opens a `Sheet` with "Create task" and "Send photo" — the second now gated on FamApp Gold rather than disabled (see Chat photos below). A **long press on a message** is the second way in, and it opens the same form with the message's text already in the title (see Turning a message into a task). Creating one goes through `FamilyContext.createTask(NewTask)`, which writes **task first, chat second**: `taskService.createTask` → the optional note as an ordinary `sendMessage` from the user → `chatService.sendSystemMessage` announcing it → `taskService.linkTaskToMessage`, which sets `tasks.source_message_id`. That order is deliberate — a failure anywhere after the first step leaves a real task on the Tasks tab, whereas announcing first would leave a message about a task that never existed. Each step commits to local state as it lands, and each degradation reports itself specifically.

Chat renders a message as a `TaskMessageCard` when **a task names it in `source_message_id`** — a lookup built from `tasks`, not a flag on the message. The dependency stays one-way: lose the task and the announcement is still a readable line of chat, which is exactly what the 30-day sweep eventually causes (`source_message_id` is `on delete set null`). `NewTask` has no description because `tasks` has no description column; the composer's optional note is stored as what it actually is, a chat message. Due date is `duration_type`'s three allowed values, with the resolved `expires_at` shown underneath so the choice reads as a date.

A `system` message is therefore app-generated, and `deriveActivity` skips it — the task it announces already contributes its own Home event, and the old type test would have reported it as a photo. Both entry points (Chat's "+" and the Tasks FAB) share `TaskComposer`, and both are withheld from a user with no family, since `tasks: family inserts` has no family id to check against.

**The composer is a disclosure list, and that is a keyboard fix rather than a style.** The title field is always open — a task is its title, and everything below it has a working default. Assignee, due date and note each collapse to a single row showing the value they currently hold, and **only one may be open at a time**. Every control being on screen at once made the form taller than the space left over once a keyboard took half the window, which is how a focused field ended up behind the keys; collapsed, the three rows say "Anyone · Tomorrow · no note" in the space one of them used to take, and whichever section holds an input sits near the top of the panel when it is the one expanded. Do not flatten it back into a single stack of fields.

**Position tracking is a cadence plus a threshold, not a stream.** `LocationProvider` (`src/context/LocationContext.tsx`, read through `useLocation()`) owns the *one* timer — mounted twice it would track twice, which is why it is a provider and not a hook the Map screen calls. It takes a foreground fix every **12 minutes** and whenever `AppState` returns to `active`, then writes only if the fix is **≥ 100 m** from the position this process last *wrote* (`getDistanceInMeters` in `src/data/geo.ts`). The Map's "Locate me" is the same call with `force`, and forcing past the threshold is the only thing `force` means. A third rule keeps that from starving the row: once the stored position is **2 hours** old the next fix is written whatever the distance (`HEARTBEAT_MAX_AGE_MS`), so standing still does not eventually read the same as having stopped sharing. Consequences worth knowing: the baseline is a **ref, not storage**, holding both the coordinates and the `updated_at` the server stamped them with, so the first fix after a restart always writes; the baseline moves only after a *successful* write, so a failed one can neither make the next fix look too close to bother nor reset the heartbeat clock on a row that was never restamped; age is measured from the stored `updated_at` rather than the local clock, because that is the value presence is derived from; and the heartbeat lands on a 12-minute grid, since it is only ever evaluated on a tick. **It does not keep presence "Live".** `format.ts` calls a position stale after `RECENT_WINDOW_MS` (60 min) and live only within `ONLINE_WINDOW_MS` (5 min), so a stationary member still reads "Stale" between the 1-hour and 2-hour marks — the heartbeat bounds how far the row ages, it does not hold a badge. Shortening it below 60 min is what would change the badge, at the cost of more writes. `canShare` also requires a family: `locations.family_id` is `not null` and both RLS policies check it, so a solo user's fix is skipped rather than taken and thrown away. Background permission is never requested.

**The map is a real map now, and it is two implementations of one component.** `FamilyMap` (`src/components/map/`) is the whole of it, and the screen imports it once. On iOS and Android `family-map.tsx` is `react-native-maps` — the platform's own SDK, so Apple Maps on iOS and Google Maps on Android, with no provider forced and therefore no API key needed inside Expo Go (a standalone Android build still needs `expo.android.config.googleMaps.apiKey`, which this project has not set). On web `family-map.web.tsx` renders OpenStreetMap raster tiles itself, because `react-native-maps` has **no web implementation**: its own `MapView.web.ts` re-exports react-native-web's `UnimplementedView`, and `Marker` reaches for codegen'd native components, so importing the native file on web breaks the bundle rather than degrading it. The two share `family-map.types.ts` (`members`, `selectedId`, `focus`, `onSelectMember`) and both draw `MemberPin`. `MapCanvas` — the grid-and-roads `View` that stood in for all of this — is **deleted**; do not bring back a drawn map, and do not put a `Pressable` back inside `MemberPin`, which is now purely presentational so the `Marker` (native) or the wrapping `PressableScale` (web) can own the one touch target.

**The camera is derived, never stored.** `regionForLocations` (`src/data/geo.ts`) folds every member who has a `locations` row into a `{ latitude, longitude, latitudeDelta, longitudeDelta }` region, padded 1.8× so the drawer and the pins' own name tags do not clip anyone, with a ~400 m floor on the span so a family in one room does not open at maximum zoom. Native passes it as `initialRegion` and then `animateToRegion`s to it — gated on `onMapReady`, because Android drops a camera command sent before the surface exists, and keyed on the region's four *numbers* rather than the object, since `useFamily` hands down a fresh members array on every refresh and animating on each one would yank the map out from under a panning finger. It returns **null** for a family sharing nothing: native then leaves the SDK's own default view, web shows a world view, and neither invents a centre. `createProjection` and `CanvasPoint` are gone with the canvas that needed them; what survives in `geo.ts` is `toWorldPoint`, the plain Web-Mercator projection the web tile grid places both tiles and pins against, plus its inverse `fromWorldPoint` — added for the web map's long press, which is the one place a touch arrives as pixels rather than as a coordinate (`react-native-maps` hands `onLongPress` a real position).

Saved places do **not** move the camera, except when nothing else can: `regionForLocations` is handed the member positions, and only falls back to the places when no member is sharing one. Folding both in always would widen the frame every time somebody saved a spot across town, and — worse — centring on a member would then grow the span to reach that place, which is the opposite of what focusing means.

**The web map is tiles, not gestures.** It measures itself with `onLayout`, picks the largest whole zoom (2–19) at which the region still fits, and lays 256 px tiles from `tile.openstreetmap.org` against the world-pixel origin — real streets, districts and city names, from the same framing the native map animates to. It has no pan or pinch: a camera state of its own would disagree with the one the native SDK supplies for free. The `© OpenStreetMap` chip is required by the tile licence and is the one piece of chrome on the canvas; the public tile server covers a prototype and not a shipped app, so a real web deployment needs its own tile host. `mapCanvas` is the colour under a tile that has not arrived (and `loadingBackgroundColor` on native); `mapLine`, which only the drawn grid ever read, was dropped from both palettes with it.

`regionForLocations` takes an optional **focus**, which is the whole of the screen's camera: that coordinate takes the centre and the span grows to twice the distance to whoever is furthest from it, so re-centring can never push another member out of frame (with no focus the same formula reduces to the bounding box). The focused member lives in the route — `?member=<id>` read with `useLocalSearchParams` — not in state, so Home's presence strip can open the Map already centred on somebody, and a stale id (their `locations` row was cleared since) resolves to *no* focus rather than quietly centring on someone else. Picking the focused member again clears it.

`locationService` owns both ends of a position — `getDevicePosition()` (the one non-network boundary in `services/`, kept there because everything else about a position already lives in that file) and `updateOwnLocation()` / `clearOwnLocation()`. Its `LocationErrorCode` stays `CommonErrorCode` so `familyService` can fold `listLocations` in without widening; the sensor's own `PERMISSION_DENIED | POSITION_UNAVAILABLE` ride on a separate `PositionErrorCode`, because a refusal is permanent until system settings change while a failed fix is worth retrying next tick. A stored position lands on the map through `FamilyContext.setOwnLocation()` — a local commit like `sendMessage`'s append, not a `refresh()`; it recomputes presence and must **never** be handed a location that was not stored first, or the map would show a pin no other member can see.


### Saved places

`saved_places` is the first table that can supply a place **name**, and therefore
the first thing the map is allowed to label. A row is a member's named coordinate:
`(family_id, user_id, category, title, latitude, longitude)`, with `category` one of
`home` `school` `work` `leisure` `park` and `unique (user_id, category)` — which is
the whole of "at most five places per **member**". **There are two ceilings now**,
and they are different rules: the category list caps each member at five, and
`private.check_saved_place_limit()` caps the whole *family* at 2 on the free tier and
10 on Gold (see Premium). The second is INSERT-only on purpose — a lapsed grant must
never delete somebody's rows, so a family can legitimately sit above its own ceiling
until it prunes one. Read is family-wide, writes are the
author's own; a `saved_places_check_family` trigger pins `family_id` to the author's
actual family, since the column is denormalised for the policies the same way
`locations.family_id` is.

A place is dropped by **pressing and holding the map** — both targets, which is what
`fromWorldPoint` is for — or by the Map's "Save a place" button, which seeds the pin
at your own position and is disabled when there is no position to seed it from. The
whole flow after that lives in **one `Sheet` that swaps its children** across
`'none' | 'details' | 'form' | 'delete'`, for the same iOS reason Chat's "+" menu
does: presenting one `Modal` while dismissing another in the same frame is
unreliable. That is also why deleting a place is confirmed *inside* that sheet
rather than in a `ConfirmDialog`, which would be exactly the second modal. The
screen closes the sheet after a successful delete, because the confirmation unmounts
with the row it was describing and would never reach its own `onClose`.

**Proximity is computed, never stored.** `membersAtPlaces` (`src/data/places.ts`)
folds each member's `locations` row against the family's places with
`getDistanceInMeters`; ≤ **100 m** counts as "at" — the same order as the tracker's
write threshold on purpose, since a tighter radius would flicker against positions
that were never written. Home's `LiveStatusPill` ranks that above a bare position
(it is the same fact said better) and below a deadline, and it checks freshness
*first*: only a member inside `isRecentlySynced` can be claimed to be somewhere. No
visit log was added and none should be — a stored match is wrong the moment somebody
moves, which is the whole reason this is a fold.

The sentence is three catalog keys, not one built here: `places.at`
("Mehmet at Beach Park"), `places.atOwned` ("Sami at Mehmet's Home") and
`places.atYours`. Which one applies is decided by the category — `leisure` and `park`
are public, so nobody's name improves them — and by who is reading; *where the
owner's name goes* is a suffix in English, a preposition in French and a case ending
in Turkish, so that part is the translator's business.

### Chat photos

**The bucket was always there; the read path was the missing half.** `chat-media` is **private**,
so `messages.media_url` holds an object *path* and never a URL — which is why an `image` row
rendered as a grey placeholder for as long as it did. `src/services/chatMediaService.ts` is the
whole of the new machinery: `newMessageId()`, `pickImage()`, `compressImage()`,
`uploadChatImage()`, `deleteChatImage()`, `getSignedMediaUrl()` and `forgetSignedMediaUrl()`. It is the one service that reaches Storage
rather than PostgREST, and it keeps the `ServiceResult` contract like every other.

Four facts there are the schema's, not preferences:

- **The object key is `<family_id>/<user_id>/<message_id>.webp` — three segments.**
  `chat-media: upload to own path` checks `foldername[1]` against the caller's family *and*
  `foldername[2]` against `auth.uid()`, so a two-segment key such as `<family_id>/<id>.webp` is
  refused by RLS however tidy it looks — that refusal is a 403 on upload, not a warning. `delete
  own or admin` reads the same convention, so does the `cleanup-media` Edge Function, and so does
  the `messages.media_url` column comment.
- **The last segment is the id of the message the object belongs to**, decided by
  `newMessageId()` *before* either write, and passed to both `uploadChatImage` and
  `sendImageMessage`. So the row and the object name each other in both directions: an orphan on
  either side names its counterpart instead of being a filename nothing joins back to. Writing
  `messages.id` from the client is safe because `messages: send as self` still pins `sender_id`
  and `family_id`, so a chosen id buys nothing and a colliding one is a duplicate-key error.
  It is a **v4-shaped** id built on `Math.random`, not `crypto` — Hermes has neither
  `randomUUID` nor `getRandomValues`, and the `uuid` in `node_modules` belongs to an Expo config
  plugin. That is acceptable *here* only because the id is not a secret: RLS decides who may read
  a message, never the difficulty of guessing its name.
- **WebP at 1080 px / 0.75**, re-encoded by `expo-image-manipulator` before anything is uploaded.
  **The re-encode is a security barrier before it is a size one**: decoding to pixels and writing
  a fresh file drops every EXIF block (which is also why the picker gets `exif: false` — GPS in a
  holiday photo is the family's location by another route), colour profile, appended payload and
  anything that was never an image at all, since that last one fails to decode and is reported as
  `PROCESSING_FAILED` rather than handed to Storage. So it is never skipped: an image already
  narrower than the cap is not upscaled, but it still goes through the encoder. WebP over JPEG
  for the bytes — about a third smaller at equivalent quality, landing in a 150–200 KB band — and
  it encodes on all three targets (`SDImageWebPCoder` on iOS, Skia on Android,
  `canvas.toBlob('image/webp')` on web) and is in the bucket's `allowed_mime_types`. The picker is
  asked for `quality: 1` on purpose: its own compression would be a *second* lossy pass.
- **Cancelling is not a failure.** `pickImage` resolves to `null` data with a `null`
  error when the user backs out, so no caller has to suppress an "error" the user caused on
  purpose.

**base64 → bytes is done by hand, and had to be.** Hermes has no `atob` and React Native ships no
`Buffer`; Supabase's own React Native guide reaches for `base64-arraybuffer`, which would be
another entry on a `package.json` that already carries too many unused ones. The twenty-line
decoder in that file is the trade. Its length formula takes the byte count from the *stripped*
string — subtracting a padding count as well truncates the tail of every image whose length is
not a multiple of 3, which is a corrupt WebP about a third of the time rather than an obvious
failure. It is verified exact for every input length 0–599 and on a real `RIFF…WEBP` header, by
transforming the actual source with sucrase and running it in node.

**Signed URLs are cached at module scope, keyed on the path**, for an hour less a 60-second skew.
Per component would re-sign on every scroll pass, since the chat list unmounts bubbles as it goes.
`expo-image` then gets `cacheKey: path` rather than caching against the URL, because the signature
changes hourly and the bytes behind it never do — the same reasoning that keeps a path (not a URL)
in the row. `ChatImage` in `message-bubble.tsx` is four states: `signing`, `loading`, `loaded`,
`failed`. The failure is **terminal and does not retry** — the ordinary causes (the media sweep
took the object, or the viewer has left the family the key names) will still be true next time —
but the cached URL is dropped on the way out so a later remount signs afresh.

**Tapping a loaded photo opens `ImageViewer`** (`src/components/chat/image-viewer.tsx`), and its
whole job is the `contentFit` the bubble cannot use: the bubble is a fixed 4:3 well on `cover`, so
a run of photos does not make the day's messages jump about, which means the bubble is never the
whole picture. The viewer is `contain` on `viewerCanvas`. It **re-signs and re-downloads nothing**
— the bubble passes down the URL it already resolved and both pass `cacheKey: path`, so opening a
photo is a cache hit. Only a `loaded` photo is pressable: there is nothing to enlarge while one is
still signing, and a failed one would open onto the same failure with more ceremony. It is a
`Modal` rather than a route, so the message list keeps its scroll position, and it is the one
`Modal` on Chat that is not the single `Sheet` — safe because the two can never be open at once
(the sheet covers the list a photo would have to be tapped in), which satisfies the
two-modals-in-one-frame rule by unreachability rather than by a state machine.

`viewerCanvas` and `viewerOnCanvas` are **the one pair of tokens deliberately identical in light
and dark**. A photo viewer is a dark room in either scheme, and a light surround would tint what
the eye reads as the photo's own shadows. They are not `overlay`, which is a scrim you are meant
to see the app through; these are near-opaque ground.

**The viewer zooms, on `PanResponder` and `Animated` — not on a gesture library.** One responder
handles all three gestures, because they are one stream of touches and two responders would fight
over who claimed the finger: **pinch** (two touches, scale tracked against the distance between
them when the second finger landed), **pan** (one touch, and only while zoomed, so a stray drag at
fit-scale cannot slide the photo off its own frame) and **double tap** (toggles fit ↔ 2.5×,
anchored on the tapped point). `react-native-reanimated` is still a dependency no file imports and
`react-native-gesture-handler` is still only the root view; waking either for one screen would be
a larger commitment than the feature. Three details are load-bearing:

- **A single tap closes, and it is deferred by `DOUBLE_TAP_MS`.** The first tap of a double tap is
  indistinguishable from a single one until the window passes, so closing immediately would shut
  the viewer every time somebody tried to zoom. The delay is paid only on the background tap; the
  X button closes at once and is the honest primary way out.
- **Scale is clamped on release, not during the gesture**, so a pinch past either end resists and
  springs back instead of stopping dead.
- **Pan is bounded by `clampOffset`** — at scale *s* the picture is *s* times the frame, so half
  the overflow is as far as it can travel. Without it a firm drag flings the photo off screen and
  leaves a black rectangle with no way back but closing. It measures against the *frame*, so a
  letterboxed photo can show a sliver of ground at the extreme; erring narrow would clip content
  the user is reaching for, which is the worse failure.

Two caveats. The gesture state lives in a **ref** beside the `Animated.Value`s, because an
`Animated.Value` has no synchronous reader safe to call from a gesture callback — every commit
goes through one `apply` so the two cannot drift. And `onClose` is read **through a ref**: the
responder is memoised for the component's life while the prop is a fresh arrow on every render of
the bubble, so calling it directly would pin the first render's closure forever. **Pinch does not
work on desktop web** — there is no second touch — which is exactly why double-tap zoom exists
rather than being a convenience on top of pinch.

**The Gold gate is client-side and nothing else**, exactly like `canActOnTask`. `messages: send as
self` does not read `families.is_premium`, and neither does the upload policy, so a free family's
photo *would* be accepted by the database. `ChatActionsList` reads `useFamily().isPremium` and
gives the row a padlock, the `warning` Gold badge and "FamApp Gold required"; pressing it pushes
`/premium` instead of opening the picker. Do not describe this as enforcement, and do not build on
it — making it real means a trigger reading `private.is_family_premium()`. **No family outranks
the tier**: `messages.family_id` is `not null`, so a solo user gets "create or join a family"
rather than a paywall for something that still would not work.

**Picking is not sending.** The flow is **pick → confirm → compress → upload → post**, and the
confirmation step in the middle is the whole reason the service splits `pickImage` from
`compressImage`. Before it, the picker's own "Done" *was* the send: one tap in the OS's UI put a
photo in the family chat with no moment in which to notice it was the wrong one. Now the picker
only picks, and `PhotoComposer` (`src/components/chat/photo-composer.tsx`, the sheet's fourth
mode) shows the original file, takes an optional caption and waits. Backing out of it costs one
discarded selection and no network at all — nothing has been re-encoded, uploaded or inserted.

That is also the only place a **caption** could ever have been typed, which is why
`messages.content` on an `image` row is finally written: `messages_payload_matches_type` always
allowed it, but until there was a moment between choosing a photo and sending it there was nowhere
to type. It is one row rather than a photo followed by a text message, which is what keeps the
caption attached to its picture instead of merely near it; an empty one is stored as NULL, since a
blank string would render an empty line under the photo.

The preview is the **original**, not the re-encoded file, and the compression is deliberately
deferred to "Send" — a photo somebody thinks better of should not cost a decode and an encode, and
the original is the honest preview of what was picked anyway.

The upload order still matters the way `createTask`'s
does: the object exists before the row that names it, because a message pointing at nothing is a
broken photo for the whole family while an object nothing points at is invisible. The id comes
first and is threaded through both halves — `chatService.sendImageMessage(familyId, messageId,
path, caption)` writes the row and `FamilyContext.sendImage(messageId, path, caption)` appends it
locally, the same split as `sendMessage`. **Reconciliation needs nothing extra**: the local append and the socket's
echo of that same insert are matched on the primary key by `withMessage`, exactly as they would
be for a server-generated id, so a photo can only land once whichever arrives first.
**The photo joins the conversation before it is uploaded.** `beginImage(messageId, localUri,
caption)` commits a `pending` message the moment "Send" is pressed — *before* the re-encode, on
the original file — so the photo is in the stream from the instant the user commits to it rather
than after a compression they have no reason to wait through. The two files look the same; the
compressed one differs only in bytes. `withMessage` is what makes the swap seamless and is the one reducer
that does **not** simply ignore a duplicate id: a confirmed row landing on a pending one at the
same id *replaces* it, and does so by removing and re-inserting rather than overwriting in place,
because the server stamps `created_at` itself and leaving the row at the placeholder's index would
file it out of order against anything that arrived during the upload. A confirmed row landing on
a confirmed one is still ignored, so the local append and the socket's echo cannot both land. The
failure path removes the bubble — `sendImage` does it for a failed insert, the screen calls
`discardImage` for a failed upload, and **both are unguarded by `useIsMounted`**, because the
placeholder lives in the context rather than in the screen and leaving the tab mid-upload must
still take it back out.

The screen therefore runs two stages: `preparing` is the picker and the gaps either side of it,
`uploading` is compress-and-transfer. Failure lives on the *screen*,
in a strip above the composer, because the picker closes the sheet that started the flow — but the
strip's *progress* half only shows during `preparing`, when the picker and the re-encode have
nothing to show yet. Once the bubble is up it carries the wait, and the strip stands down rather
than saying the same thing twice on one screen.

iOS pays `MODAL_DISMISS_MS` **twice, in both directions**: the sheet closes before the picker
opens, and the picker closes before the sheet comes back holding the confirmation step. Asking iOS
to present over a controller that is mid-dismissal is the same two-modals-in-one-frame hazard that
keeps Chat down to a single `Sheet` — and the second wait is that hazard with the roles swapped,
*our* modal presenting over the picker's dismissal. Skipping it is a sheet that never appears,
leaving a photo picked and nothing to send it with.

`app.json` gains `expo-image-picker` with `photosPermission` / `cameraPermission` copy, next to
`expo-location`'s. **The camera path exists in the service and no UI reaches it** — the sheet
offers the library only, and `pickImage('camera')` is there for a second row that has
not been argued for yet.

One caveat here has **lapsed**: the image retention sweep used to be a no-op because the Vault
secrets `cleanup-media` needs had never been created. They exist on the live project now
(`project_url`, `service_role_key`), so the nightly 03:30 UTC job really does call the function
and photos really are purged after 10 days. Verify with `select name from
vault.decrypted_secrets` before relying on either statement again.

### Deleting a message

**`messages: delete own or admin` is real enforcement, not a client courtesy** — unlike
`canActOnTask` and the chat-photo Gold gate, which sit on top of permissive policies. The sender
may delete their own row and a family admin may moderate anyone's, and a client that tried
otherwise would be refused by the database rather than merely discouraged by the UI.

**A DELETE blocked by RLS is not an error — it deletes nothing and succeeds.** The policy is a
`using` clause, so a row the caller may not touch simply fails to match and PostgREST returns 204
with no complaint. Trusting that would report somebody else's message as deleted and then have it
reappear on the next refresh, so `chatService.deleteMessage` asks for the row back with `.select()`
and reads an empty array as the refusal it is (`NOT_ALLOWED`). That one branch cannot distinguish
"not yours" from "already gone" — both match nothing — and does not need to: a row already swept
or removed elsewhere is in exactly the state the caller wanted.

**Row first, object second, and the object's failure is not reported.** `FamilyContext.deleteMessage`
deletes the row, then fires `chatMediaService.deleteChatImage` for an image message without
awaiting its verdict. The two orders fail differently and only one is survivable: dropping the
object first and then failing on the row leaves a message pointing at nothing, which is a broken
photo for the whole family; dropping the row first and then failing on the object leaves something
invisible that the 10-day `cleanup-media` sweep collects. That is the upload's own order in
reverse. `forgetSignedMediaUrl` runs regardless, so a cached URL for a dead object cannot be handed
to `expo-image` afterwards.

**It is optimistic, and the restore is what makes that safe.** The row leaves the local list
before the request goes out and is put back — *in its own place*, because `withMessage` re-files by
`createdAt` rather than appending — if the server refuses. The message object is captured before
the removal, since it is the only copy left afterwards and is also where `mediaUrl` is read from.
A `pending` placeholder is dropped locally without asking the server at all, there being no row yet.

**The UI is a long press *into the message menu*, and the confirmation is still `ConfirmDialog`** —
never `Alert`, which does not exist on web. The gesture stopped going straight to the dialog when a
second thing could be done with a message (see Turning a message into a task): it now opens the
sheet, and "Delete message" is the row that asks. The *screen* owns one dialog rather than each
bubble owning its own: a `Modal` per message would mount two hundred of them to ask one question.
The bubble is a `PressableScale` with `feedback="none"` (a tap on a bubble does nothing, and
buzzing for a non-event is wrong) that fires its own `tap` haptic on the long press — `warning`
moved to where something is actually risked, which is the dialog. On a photo message the long press
is **forwarded into `ChatImage`**, because RN gives the touch to the deepest view that claims it and
the picture is most of the bubble — without that, only the thin margin around it would respond.

**Menu to dialog is the one place Chat presents a second `Modal`, and it pays for it.**
`requestDelete` closes the sheet, waits `MODAL_DISMISS_MS`, and only then opens the dialog — the
same gap the picker is given in both directions, and for the same iOS reason. The alternative was
the Map's in-sheet confirmation, which was not taken here because the dialog is where the write
already lives: it holds its own spinner and renders a refusal in place, which is what makes an
optimistic delete safe to offer.

A deletion reaches the other devices **live**, which is the one thing this needed from the realtime
layer: `messages` carries `replica identity full`, so its DELETE event arrives with the old row and
the `family_id` filter can match it. See the Realtime section.

### Turning a message into a task

**Long-pressing a bubble opens a menu, and "Create task from message" is a prefill — nothing more.**
`MessageActionsList` (`src/components/chat/message-actions-sheet.tsx`) is the menu; picking the task
row swaps Chat's one `Sheet` to the same `TaskComposerForm` the "+" opens, with `initialTitle` set
to the message's own text. From there every step is the existing flow: `FamilyContext.createTask`
writes the task, posts the note, announces it and links `tasks.source_message_id` to **the
announcement it just wrote**.

That last point is the design decision, and it is deliberate rather than an omission. Pointing
`source_message_id` at the *converted* message would have been the shorter route to "reflected
inline in the chat", and it is wrong twice: Chat draws any message a task names as a
`TaskMessageCard`, so the author's own line would be **replaced** by a card — their words gone from
the conversation the moment somebody made a task out of them — and that card credits its author from
`message.senderId`, so a task Sami created from Mehmet's message would read "MEHMET ADDED A TASK".
The announcement is the row that is honestly about the task, which is why it is the row the task
names. The original message stays exactly where it was, as its author wrote it.

Three rules decide what the menu offers, and each is a fact about the row rather than a preference:

- **A `system` message cannot be converted.** It is the app's own announcement of a task that
  already exists, so its text is copy nobody wrote — and the task it announces is already on the
  Tasks tab. The row is dimmed and says why, the same way the "+" menu dims what a solo user cannot
  do.
- **A photo with no caption cannot be either**, having no text to title anything with. A caption
  *can*: it is the sender's own words, so `taskTitleFrom` reads `content` rather than testing
  `type`.
- **The seed is capped at `MAX_TASK_TITLE_LENGTH` (200), and a message may be 500.** `maxLength` on
  the title field only bounds what is *typed* into it, so an over-long prefill would otherwise sit
  in the form with "Create task" greyed out and nothing on screen explaining the refusal. It is cut
  to 199 plus an ellipsis, which is a marker the user can edit around.

The long press itself is offered when *either* row would be live — this message is one the caller
may delete, or it carries text a task could be titled with — so a member who cannot delete somebody
else's message can still turn it into a task, and a photo with no caption from another member keeps
the inert bubble it always had. The sheet's header repeats the message back (`ACTION_EXCERPT_LENGTH`,
120 chars), because the panel covers the list it was opened from and the menu would otherwise be two
actions with no subject.

`ActionRow` (`src/components/chat/action-row.tsx`) was extracted out of `ChatActionsList` so this
menu and the "+" menu cannot drift: one row component, one set of states (available, dimmed with a
reason, busy, sold), and a `tone` for the destructive one. It is the same reasoning that keeps
`TaskComposerForm` shared between Chat and the Tasks FAB.

### Keyboard behaviour in Chat

The message list is `keyboardDismissMode="on-drag"` plus `keyboardShouldPersistTaps="handled"`, and
both halves are needed. Dragging the conversation in either direction puts the keyboard away —
reading back through the day is the clearest signal somebody has stopped typing, and `interactive`
was not used because it ties the keyboard to the finger and so only responds to a downward drag.
`handled` is what keeps a tap that lands on something from being swallowed by the dismissal:
without it the first tap anywhere in the list is spent closing the keyboard, so opening a photo or
long-pressing a bubble would need two.

### Push notifications

**Registration is the client half; `20260829100000_push_notification_triggers.sql` is the server
half.** `src/services/notificationService.ts` is the whole of the client side —
`requestPushPermission()`, `getExpoPushToken()`, and the two the switch calls,
`registerForPushNotifications()` / `unregisterFromPushNotifications()`. Together they ask the OS,
ask Expo for a token, and write it to `profiles.push_token` (or NULL it).

**That column now has a reader**, which it did not before: three triggers hand chat and task
events to `private.dispatch_push()`, which posts them over `pg_net` to the `send-push` Edge
Function, which looks up the family's tokens and calls Expo. See "The push sender" below.
**The server half is live and verified** — a message insert on the live project queues a request
that returns HTTP 200 from `send-push`. **Nothing is delivered even so**, for one remaining
reason: no device here can obtain a push token, so every send resolves to `recipients: 0`. The
switch still
honestly means "this device is registered", never "you will be notified" — do not write copy that
promises delivery until a device can actually receive one.

It is the only service that writes `profiles` outside `familyService.updateOwnProfile()`, and
deliberately so: that function offers the four fields a member's *identity* is made of, and a push
token is not identity — it is the address of one device, it changes without anyone editing
anything, and it is the one profile column with a write guard of its own.

**`PushErrorCode` is wider than the other services' because four of its failures happen on a device
that is working perfectly**, and the screen has to be able to say which:

| code | when |
| --- | --- |
| `PERMISSION_DENIED` | the user said no — the only one they can undo, and the only one worth not re-asking |
| `UNSUPPORTED` | web (no VAPID keys, no service worker) or a simulator (`Device.isDevice` is false) |
| `NOT_CONFIGURED` | `app.json` carries no `extra.eas.projectId`, so a token cannot be attributed |
| `TOKEN_UNAVAILABLE` | Expo Go — remote push was removed from it in SDK 53 — or Expo's token service failing |

The last two are the state of this project *today*: there is no EAS project and development happens
in Expo Go and the browser, so **the switch cannot currently succeed on any target available here**.
That is not a bug to paper over; it reverts and names itself, and a development build from an
`eas init`'d project is what changes it.

`profiles.push_token` (`20260825120000_push_tokens.sql`) carries one caveat worth repeating: the
`profiles: read own and family` policy is family-wide and the grants are table-level, so **every
member of your family can read your push token**, which is a send capability. The write side *is*
closed — `guard_profile_columns()` gained a clause rejecting a token written onto anyone else's row,
which the `profiles: admin updates members` policy would otherwise permit. Close the read side
(column privileges plus explicit column lists in `familyService`, or a separate `push_tokens` table)
before this faces real users — that caveat was cheap while nothing read the column, and the
sender below is what starts spending it.

#### The push sender

**Three triggers, one dispatcher, one Edge Function, and none of it can block a write.**
`20260829100000_push_notification_triggers.sql` adds `messages_notify_push` (AFTER INSERT),
`tasks_notify_push_insert` (AFTER INSERT) and `tasks_notify_push_completed` (AFTER UPDATE OF
status, with a `when` clause pinning it to the *transition* into `completed`, so editing an
already-finished task fires nothing). Each hands the event to `private.dispatch_push()`, which
posts to `supabase/functions/send-push/`.

Four properties are the design, not incidental:

- **`pg_net` is what makes it non-blocking.** `net.http_post` writes the request into
  `net.http_request_queue` and returns a request id; a background worker sends it after commit.
  Expo being slow or unreachable therefore cannot slow a chat insert down.
- **Every trigger body sits in an `exception when others` block**, which is a subtransaction: a
  failed dispatch rolls back and the INSERT or UPDATE it hangs off still commits, with a
  `raise warning` naming why. A notification is a side effect and must never be able to reject
  the row that caused it. This is verified — a `net.http_post` rigged to raise, and a missing
  `vault.decrypted_secrets`, both leave the row written.
- **It degrades to a no-op when the Vault secrets are missing.** `dispatch_push` reads the same
  `project_url` / `service_role_key` pair as the media sweep and returns without posting when
  either is absent. Both **do** exist on the live project, so the path is active there; a
  restored or forked project without them installs and fires and queues nothing.
- **`authenticated` cannot call the dispatcher.** EXECUTE is revoked from it, which does not
  stop the triggers (Postgres does not check EXECUTE on a trigger function against the
  triggering user) but does stop a client turning it into an arbitrary push cannon.

`system` messages are **skipped** by the message trigger. They are the announcements
`createTask` writes after the task itself, so notifying on them would buzz twice for one event —
the same reason `deriveActivity` skips them on Home. Recipient selection lives in the Edge
Function, which always excludes the sender and always scopes to `family_id`; `recipient_ids`
narrows within that and distinguishes **NULL** ("the whole family") from **`{}`** ("nobody"), so
a caller with no recipients must skip the call rather than pass its empty result.

`send-push` itself sends **one message object per token** rather than one object with a `to`
array, because that is what keeps Expo's ticket list index-for-index with the batch — the only
way to know *which* token was rejected. It batches at Expo's limit of 100, dedupes tokens (two
accounts on one device share one, and should buzz once), and drops anything not shaped like
`Ex(po|ponent)PushToken[…]`. `DeviceNotRegistered` is the **only** error that clears a token:
it is the one permanent, device-specific failure Expo reports, and clearing on
`MessageRateExceeded` would unregister a working phone. That cleanup is an UPDATE from
`service_role`, which `guard_profile_columns()` exempts — the clause that stops a family admin
writing somebody else's token deliberately lets the server clear a dead one.

**Notification copy is composed in SQL and is therefore English.** There is no `Translator` in
reach of a trigger and no way to know the reading device's language, so it joins the database's
own `raise exception` strings as the second place FamApp ignores the language picker. The honest
fix is the same one that section names — send a message code plus its variables and render
client-side — and it needs a client that receives pushes at all.

#### Geofence pushes

**A fourth trigger, and the first one Gold actually gates.**
`20260830100000_geofence_push_triggers.sql` adds `locations_notify_geofence` (AFTER INSERT OR
UPDATE), which is what finally puts an event behind the tier's saved-place alerts. It needs no new
table: `locations` is one row per member, upserted, so an UPDATE already carries both positions —
OLD is where the tracker last wrote, NEW is where they are now — and a crossing is those two rows
classified against the same circle. A `place_visits` table would be the alternative and would be
wrong for the reason `saved_places` already gives for not having one.

`private.geo_distance_meters()` is a transcription of `getDistanceInMeters` in `src/data/geo.ts`,
same earth radius and same `asin` clamp; the two are verified to agree to the last printed digit
across nine pairs including antipodal and near-polar ones, and they must stay in step for the
reason `is_family_premium` and `isPremiumActive` must. The radius is `PROXIMITY_RADIUS_M` (100 m)
and it has to be: a push saying "Sami arrived at Home" while the app does not yet say "Sami at
Home" is the app contradicting itself about one fact.

Five properties are the design:

- **No hysteresis band, and that is the safe choice rather than the lazy one.** Enter-at-100 /
  leave-at-150 is unsound without stored state: the only record of where a member was is OLD, and a
  position resting inside the band reads as "outside" on the next tick, so the departure the band
  exists to delay is not delayed — it is lost. One radius applied to both rows cannot leak an event.
- **Only a transition dispatches, which is the whole anti-spam story.** The tracker already refuses
  to write a fix under 100 m from the last one it wrote, so jitter never reaches the table; a
  stationary 2-hour heartbeat restamps `updated_at` with identical coordinates, so OLD and NEW
  classify the same against every place and nothing is sent. The identical-coordinates check in the
  trigger is an early exit, not the rule that makes it safe.
- **An INSERT is a silent baseline.** There is no OLD, so there is no transition — and it matters
  more than a technicality, because `clearOwnLocation()` *deletes* the row, so an INSERT is exactly
  what toggling location sharing produces. Firing there would announce "Sami arrived at Home" every
  time Sami flipped a switch at home. A family change is treated the same way: OLD's distances were
  measured against circles the new family cannot see.
- **The Gold gate is server-side**, unlike `canActOnTask` and the chat-photo padlock. Knowing where
  the family is stays free — that is a fold over rows every member can read. Being *told* is what is
  sold, so `private.is_family_premium()` decides, and a lapsed grant stops the pushes without
  touching a row.
- **A place is named from the mover's point of view.** `private.push_place_label()` mirrors
  `placeSentence()` as far as one body can: bare title for `leisure`/`park` and for the mover's own
  places, owner-possessive otherwise ("Left Mehmet's Home"), because "Left Home" broadcast to a
  family is ambiguous the moment two members have saved one. The client's third form —
  `places.atYours`, rendered per *reader* — has no analogue and cannot have one, since a push
  carries one body to every device.

One divergence from the client is deliberate. `nearestPlace` names the *closest* place within the
radius, so where two circles overlap the app names one at a time; this trigger is per-fence, so
drifting between two overlapping circles produces no event even though the in-app sentence changes.
Enter/exit per fence is the geofence semantic; "which place are they at" is a different question and
the client is what answers it. Crossing two fences in one move fires twice, because both crossings
are true.

Like the other three, the body sits in `exception when others` and the position commits even when
the dispatch raises — verified against a `dispatch_push` rigged to fail.

### Premium (FamApp Gold)

**The purchase is a mock; the subscription is not.** `src/app/premium.tsx` still has no payment
SDK and no receipt — the two prices are constants in that file and nothing is charged — but the CTA
now calls `purchaseService.purchasePlan`, which goes through the `set_family_premium()` RPC and
writes `families.is_premium` / `families.premium_until`. So the *offer* is fiction and the *state*
is a row: a family that subscribes stays subscribed across a reload, on every member's device.
That does not break the rule that nothing is rendered the schema cannot supply — the rule exists to
stop *family data* being invented, and an offer is not a fact about this family.

**The tier belongs to the family, not the member**, because every benefit is a family-wide ceiling
and one subscription covers everybody. Both columns are needed and neither is the answer alone:
active is `is_premium and (premium_until is null or premium_until > now())`, written once in SQL as
`private.is_family_premium()` and once in TS as `isPremiumActive()` in **`src/data/premium.ts`**,
which also owns `PremiumPlan` and the place ceilings. `FamilyContext` folds it into `isPremium`,
and that is what every screen reads — never the two columns directly.

**Writes are RPC-only, like membership.** `families: creator updates` would otherwise let the
creator flip `is_premium` with one PostgREST call, so `private.guard_family_columns()` rejects a
direct write to either column (and to `join_code`/`created_by`/`created_at`), and
`set_family_premium()` — SECURITY DEFINER, so `current_user` is the owner and the guard lets it
through — is the only way in. **It verifies nothing**; when a store exists, receipt validation goes
inside that function, and `purchasePlan` becomes the thing that hands a token over rather than the
thing that decides. The plan picks the window server-side (annual → the 7-day trial the CTA
promises, monthly → one month), and a second purchase *extends* an existing grant rather than
replacing it.

**Two benefits are enforced now; the other three are still tier copy.** Saved places is the
ceiling this split first moved — 2 per family free, 10 on Gold, in
`private.check_saved_place_limit()`. The second is the saved-place arrival/departure push, which
stopped being copy when `20260830100000_geofence_push_triggers.sql` gave it an event to hang off:
`private.notify_on_geofence()` returns early unless `private.is_family_premium()` says yes, so the
gate is the database's rather than the client's — see Geofence pushes below. The member trigger
still caps every family at 10 whatever they pay, the task trigger counts 20 active per *family*
rather than per member, and chat photos are built but gated in the client alone. Making any of
those real means the same narrowed trigger reading `private.is_family_premium()`, not a copy
change.

| Benefit | Free | Gold | Enforced? |
| --- | --- | --- | --- |
| Family members | 5 | 10 | no — trigger caps all at 10 |
| Saved places **per family** | 2 | 10 | **yes** — `check_saved_place_limit()` |
| Group chat photos | text only | photo sharing | no — **client-side only** |
| Active tasks **per member** | 2 | 10 | no — 20 per family |
| Saved-place arrival/departure | in-app only | push notifications | **yes** — `notify_on_geofence()` |

**No claim on this screen may be "unlimited", and none may be a number no schema could hold.**
"Unlimited saved places" and "30-day location history" were both removed for that reason — the
category list is the ceiling per *member* (five, see Saved places), the tier is the ceiling per
family, and there is no history table at all, so each was selling something that could never be
delivered. Every remaining line names a finite number.

**The paywall has three faces, and the plan picker is conditional.** Never subscribed: the offer,
the plans, "Start 7-day free trial". Gold and unexpired: the date it runs to, the benefits as a
list of what is *theirs*, and no prices — showing them to somebody who already pays is asking them
to buy what they have. Gold and lapsed: when it ran out, plus "Renew". A "Restore purchase" ghost
button sits under all three; it re-reads the family row (there is no store to replay) and
deliberately does **not** close the screen, because the answer it fetches is the hero above it.
The purchase order is write → `refresh()` → confirm, so Home and Profile have re-read the row
before this screen dismisses itself.

Home's `PremiumBanner` is **withheld** once the family is on Gold — an advert for what somebody
already pays for reads as the app not knowing. Profile keeps its row, because that one is where a
subscription is *managed*: same `warning` badge slot, "Active" instead of "Gold".

**The saved-place ceiling is explained, not just enforced.** Past it, the Map's one `Sheet` opens
in a fifth mode (`locked`) instead of the form — the write would be refused anyway, and letting
somebody pick a category and type a name first only makes the refusal cost more. It names the
count, and it branches: a free family gets the paywall as its primary action, a Gold family gets
"delete one to make room", because selling Gold to a Gold family is the same mistake as the banner.
The form shows the count before the ceiling is hit. `check_saved_place_limit()` is still what
decides, and its refusal arrives as `LIMIT_REACHED` — the one P0001 on that table that does *not*
pass through as server text, because the UI answers it with an upgrade prompt rather than a number.

The fourth benefit is the one with a boundary worth stating twice: **knowing where the family is
stays free for everyone.** Home's `LiveStatusPill` and the "Sami at Mehmet's Home" sentence are a
fold over rows every member can already read (`membersAtPlaces`), and folding is not a feature that
can be taken away without taking the rows away. What Gold sells is the *push notification* on
arrival and departure, and now that the notification exists the boundary is a line of SQL rather
than a promise: `notify_on_geofence()` gates on the tier, and the in-app sentence never asks.

Two entry points, both pushing the same route: `PremiumBanner` on Home and the "FamApp Gold" row
on Profile. It is mounted with `presentation: 'modal'` because it is an interruption the user did
not navigate *into* — both callers expect to still be underneath when it closes — and its way out
is `NavHeader`'s chevron with a `backFallback` of `/(tabs)`, since on web the route is reachable
by URL with nothing beneath it.

The Home banner sits **below** the tiles rather than under the header: two washes stacked at the
top stop reading as "the top of the screen", and the family's own rows are what someone opened
Home for. It is the app's only promo surface; there should not be a second.

Confirmation is rendered **in place of the CTA** — not `Alert`, which does not exist on web, and
not a second `Modal`, which cannot be presented while this screen is dismissing itself. The
dismissal is a `setTimeout` cleared on unmount and guarded with `useIsMounted()`, because the
chevron lets the user beat it there.

Prices stay in **US dollars in all ten catalogs**. There is no store to quote a local price, and a
localised number with nothing behind it would be invented twice. The product names ("FamApp",
"Gold") are not translated, like "FamApp" everywhere else.

**Still not wired:** The Notifications switch **registers the device** — `notificationService.ts` asks for permission, fetches an Expo push token and writes it to `profiles.push_token` (NULL when the switch is off) — and a **sender now exists** server-side (`send-push` plus the three triggers). What is missing is the two ends around it. The switch cannot succeed in the environments this project is developed in: remote push was removed from Expo Go in SDK 53, and `app.json` has no `extra.eas.projectId`, so the token request fails with `TOKEN_UNAVAILABLE` / `NOT_CONFIGURED` until there is a development build from an EAS project. Every such failure reverts the switch and names itself, which is the visible behaviour today. The **server** side is done and proven on the live project — migration pushed, `send-push` deployed, Vault secrets present, and a real insert observed returning HTTP 200 — so a token is the only thing still missing. `profiles.push_token` is NULL on all 7 rows, which is why every send currently reports `recipients: 0`.

### Realtime

**One websocket, one channel, keyed on the family.** `src/services/realtimeService.ts`
opens `family-${familyId}` and binds eight `postgres_changes` listeners — `messages`
(INSERT/DELETE), `tasks` (INSERT/UPDATE/DELETE), `locations` (INSERT/UPDATE) and `profiles`
(UPDATE) — each filtered `family_id=eq.…`. It is a service like every other: the socket
is network, so it lives here and `FamilyContext` never touches `supabase`. What it hands
up is domain types through the **same mappers the fetching services use**
(`toChatMessage`, `toFamilyTask`, `toMemberLocation`), so a row off the socket is
indistinguishable from one off HTTP. `profiles` is the exception and hands up the raw
row: a profile cannot say where its member is, and the position the roster already holds
is the one to keep.

**Duplication is settled by reducers, not by suppressing the echo.** Every commit into
`LoadedFamily` — this device's own write *and* another member's event — goes through
`withMessage` / `withoutMessage` / `withTask` / `withoutTask` / `withLocation` / `withProfile` in
`FamilyContext`, all matching on the primary key. So `sendMessage` appending the row its
insert returned and the socket delivering that same row a moment later can only land
once, in either order. Each reducer returns the state it was handed when there is nothing
to do, so React skips the render. They also keep the fetch order: tasks re-sort by
`expires_at`, members by admin-then-`created_at`, and a message is spliced by
`createdAt` rather than appended, because a socket event and a local append can cross.

`withMessage` has the one exception to "same id means ignore it": a confirmed row landing on a
**pending** one replaces it, which is what retires an optimistic photo bubble (see Chat photos).
`withoutMessage` is likewise not a general delete — nothing removes a real message, and no delete
listener could hear it anyway, since only `messages` and `tasks` carry `replica identity full`;
it exists to take that bubble back when the send fails.

Three things fall out of the schema rather than out of preference:

- **A timestamp off the WAL is not the ISO 8601 PostgREST returns.** Postgres' own text
  format (`2026-08-25 12:00:00.123456+00`) breaks both `Date.parse` (presence, due dates)
  and the plain string comparisons that order the chat — a space sorts before a `T`, so
  every incoming message would file at the top of its day. `toIsoTimestamp` **repairs**
  rather than reformats: a value already in PostgREST's shape comes back byte for byte,
  which is what lets fetched and streamed rows share one sorted list.
- **Nothing listens for a delete on `locations` or `profiles`.** Only `messages` and
  `tasks` carry `replica identity full` (see the Realtime block in the init migration), so
  a delete elsewhere sends the primary key alone — the `family_id` filter cannot match it
  and the event is never delivered. Two consequences: switching location sharing off
  clears the pin on the *owner's* device only, and a member being removed (or leaving)
  reaches everyone else on the next refresh. Both are `replica identity full` migrations
  away, and neither should be faked client-side. **`messages` does have it**, which is
  what lets a deleted message vanish from every device live rather than on next refresh —
  the delete listener is the one thing message deletion needed from this layer.
- **A member joining arrives as a `profiles` UPDATE**, because the row already existed and
  `join_family` only sets its `family_id`. `withProfile` therefore *adds* an unknown id
  rather than ignoring it, and the roster gains the new member live.

**Realtime is a supplement, never the source.** The socket drops, and nothing that
happened while it was down is replayed. `onRejoin` fires on a *re*-join only (the first
join is the load that already happened) and the provider answers it with `reload()` — the
silent half of `refresh()`, which is split out for exactly this: pull-to-refresh owns the
`isRefreshing` spinner, and a reconnecting socket must not pull it down on its own. The
channel is keyed on `familyId` alone, which is why `reload` is reached through a ref: it
changes identity with the language (the banner it loads is a translated sentence), and a
language switch has no business tearing down a websocket.

RLS applies to every event — the realtime server re-checks the subscriber's own SELECT
policies — so `family_id=eq.…` is an index filter, not a boundary. The access token is
put on the socket by supabase-js itself on each auth state change; nothing in this project
calls `realtime.setAuth`.


## Backend (Supabase)

`supabase/` holds twelve migrations, two Edge Functions, `templates/confirmation.html` and a README
covering setup. The **migrations** are applied to the live project — treat them as history and
add a new one rather than editing an applied file. That includes
`20260825140000_family_premium_tier.sql`: it is pushed, `db advisors --type security`
reports no new ERROR (only the expected "signed-in users can execute a SECURITY
DEFINER function" WARN that `create_family`, `join_family`, `remove_member` and
`delete_account` already carry), and `gen types` reproduces the hand-applied delta in
`database.types.ts` byte for byte. `purchaseService` still maps PostgREST's `PGRST202`
to `UNAVAILABLE` for a project restored from an older migration set — the same reason
`deleteAccount()` keeps its `DELETE_UNAVAILABLE` branch. `config.toml` and `templates/` are *not* the
live truth: they describe the local stack, which cannot run here (no Docker), and most of
`config.toml` is still stock CLI defaults (`site_url` is `127.0.0.1:3000`). That is why auth
changes go through `npm run auth:config`, which patches named fields, rather than
`supabase config push`, which would shove the whole file at the project.

`deleteAccount()` maps PostgREST's `PGRST202` ("no such function") to a `DELETE_UNAVAILABLE`
code. That branch is unreachable on the current project and is kept for a project restored from
an older migration set — a missing RPC should say so rather than surface as `UNKNOWN`.

`20260804120000_member_identity.sql` adds `families.name`, `profiles.display_name` and
`profiles.color_index`, and widens `create_family` / `join_family` to take that identity. Both
RPCs are **dropped and recreated**, not replaced: `create or replace` cannot add a parameter, so
it would leave the old arity behind as an overload and make named-argument calls ambiguous. That
also drops their grants, which is why the migration re-states `revoke ... from public, anon` and
`grant execute ... to authenticated` — verify with `has_function_privilege` after any change of
this shape.

**Membership is RPC-only.** `create_family`, `join_family` and `remove_member` are
`SECURITY DEFINER` functions, and `families` has no `INSERT` grant at all. This is not
ceremony — RLS hides a family from anyone not already in it, so a joiner *cannot* look one up
by code, and the join code is generated server-side inside a uniqueness retry loop. Clients
also never write `profiles.family_id` directly: a trigger rejects it. Leaving a family is the
one exception (`family_id -> NULL` on your own row).

**Rotating that code is a fourth RPC, for three overlapping reasons.**
`public.regenerate_join_code()` (`20260901100000_regenerate_join_code.sql`) generates a
replacement through `private.random_join_code()` inside the same uniqueness retry loop
`create_family()` uses, writes it to `families.join_code` and returns it. Each of the three
would force an RPC on its own: `private.guard_family_columns()` rejects **every** direct write
to `join_code`, so no client UPDATE lands; uniqueness is settled by the unique index inside a
loop, which a single statement cannot express; and `families: creator updates` is scoped to
`created_by`, so a non-creator admin could not touch the row at all — admin, not creator, is the
boundary this wants. SECURITY DEFINER is what gets it past the guard, whose first clause exempts
the owning role, exactly as `set_family_premium()` already relies on. **The guard is not relaxed
by this**: a client still cannot *choose* a code, only ask for a generated one.

It is admin-only, and checks `private.current_family_id()` *and* `private.is_family_admin()`
behind one 42501 sentence — a profile can legitimately carry `is_admin` with a NULL `family_id`,
since `guard_profile_columns()` lets a member clear their own and says nothing about `is_admin`,
and "admin of no family" is not an admin of anything. That one sentence is also why the feature
needed no new `FamilyErrorCode`: `familyService` already maps 42501 + `/admin/i` to `NOT_ADMIN`
with the server's text. **Nobody is ejected** — membership is `profiles.family_id`, which this
never writes; the old code stops working only because `join_family` reads the column.

**Deleting an account is an RPC for the same reason, plus a worse one.**
`public.delete_account()` is `SECURITY DEFINER` because the publishable key cannot reach
`auth.users` at all. The delete is one statement; the migration exists for what hangs off it —
`families.created_by` references `auth.users (id) on delete cascade`, so deleting the creator of
a family that still has members would take the family, its messages, its tasks and its locations
with it. Ownership is therefore handed to the longest-standing remaining admin (or member)
*before* the user row goes, a family whose last member is leaving is deleted outright, and a
family left with no admin gets one promoted. The account's own rows are meant to go: `profiles`
cascades from `auth.users`, and that member's messages, created tasks and location cascade from
`profiles` — tasks merely *assigned* to them survive with `assigned_to` NULL.

**A service names a catalog key, never a sentence.** `fail(code, 'errors.family.notFound')` stores
`messageKey` alongside an English `message`, and the screen renders `errorText(i18n, error)` — a
service has no `Translator` and no business guessing which language it is failing in. The exception
is text the *server* wrote: `fail(code, { text: message })` passes a database `raise exception`
through as-is ("This family is full (10 of 10 members)"), and those stay English, because
translating them would mean parsing a sentence for its numbers. `error.message` remains the English
fallback for logs.

**Every service call returns `ServiceResult`, never throws.** Branch on `error.code` — a closed
union per service, both of which include `NOT_AUTHENTICATED | OFFLINE | UNKNOWN` from
`result.ts`. `error.message` is safe to render; the database's own messages ("This family is
full (10 of 10 members)") are already written for humans and are passed through deliberately.

Business rules live in triggers, not application code: 10 members per family, 20 active tasks,
500-char messages, 10-day image / 30-day text retention via `pg_cron`. Don't reimplement them
client-side; surface the error.

**The image sweep runs now.** It reads `project_url` and `service_role_key` from Vault to call
the `cleanup-media` Edge Function, and both secrets exist on the live project, so the 10-day
retention is real rather than aspirational. It was a no-op for a long time and older notes in
this file said so; check `vault.decrypted_secrets` rather than trusting either claim. All four
`pg_cron` jobs are active.

### Backend gotchas that cost real debugging time

- **An `UPDATE` re-checks `SELECT` policies against the *new* row.** You cannot update a row out
  of your own visibility — no `WITH CHECK`, however permissive, will save you (`with check
  (true)` still fails). This is why kicking a member is `remove_member()` rather than an update
  clearing `family_id`: the moment it goes NULL the row stops being visible to the admin doing
  it. Self-removal works as a plain update only because the SELECT policy has an
  `id = auth.uid()` arm.
- **Supabase's default privileges grant ALL on new `public` tables to `anon` and
  `authenticated`** — including `TRUNCATE`, which RLS does not restrain. Enabling RLS is not
  enough; migrations must `revoke all` then re-grant the specific verbs. The
  `auto_expose_new_tables` comment in `config.toml` claims otherwise; check
  `information_schema.role_table_grants` rather than trusting it. `db advisors` catches this.
- **A push trigger can be proved on the live project without sending anything.** `net.http_post`
  only *inserts* into `net.http_request_queue`, and that insert is transactional — the background
  worker reads committed rows, so a `begin; …; rollback;` block fires the trigger, lets you read
  the exact request body it queued, and un-queues it. That is how the geofence trigger was verified
  against real rows (flipping the family to Gold and moving two members) with nothing committed and
  no notification sent. Two snags: `net.http_request_queue.body` is **`bytea`**, not jsonb, so it
  needs `convert_from(body,'utf8')::jsonb` — casting straight to jsonb fails with "cannot cast type
  bytea to jsonb" and takes the whole batch down with it; and `db query --linked` aborts the
  entire statement batch on any error, which rolls the block back anyway.
- **`db query --linked` prints only the *last* result set.** A verification script that ends on a
  bookkeeping `select count(*)` therefore throws away the answer it was written to show. Put the
  interesting statement last, or gather everything into one final `select` — inside the
  transaction, `create temp table r on commit drop as select public.my_rpc()` is what lets the
  returned value and the row it changed be compared side by side. They do have to be **separate
  statements**: `select public.my_rpc(), (select join_code from public.families where …)` reports
  the code as *unchanged*, because every subquery reads the snapshot taken when the statement
  began rather than the row the volatile function has just written. That reads as the RPC
  silently doing nothing, and it is the statement shape lying, not the function.
- **The throwaway Postgres cannot keep its socket in the scratchpad.** A unix socket path is
  capped at 103 bytes and the per-session scratchpad spends ~110 before adding a filename, so
  `psql -h <scratchpad>` fails with "Unix-domain socket path … is too long" while the cluster is
  up and perfectly healthy — which reads as a server that never started. Give `pg_ctl -o` a
  `-k /private/tmp/<short>` and point `psql -h` at that same directory; only the socket is
  length-limited, so the data directory can stay in the scratchpad. Worth the setup: with stubs
  for `auth.uid()` and the `private` helpers, `20260901100000_regenerate_join_code.sql` was
  exercised offline — admin rotation, both refusal paths, `guard_family_columns()` still blocking
  a direct UPDATE, and the retry loop's give-up path — before anything reached the live project.
- **Direct DML on `storage.objects` is blocked on the hosted project** ("Use the Storage API
  instead"), so SQL cannot free storage bytes — only the `cleanup-media` Edge Function can.
- **A SQL-language function body is validated at creation time**, so a helper that selects from
  a table must be defined *after* that table in the migration.
- Auth state on the live project: **Google is not enabled** (`signInWithGoogle()` pre-flights
  `/auth/v1/settings` and returns `PROVIDER_DISABLED` rather than opening a browser onto the
  400 JSON body Supabase serves for a disabled provider). Supabase's email validator also
  rejects `@example.com` and `.invalid` domains, which makes scripted signup testing awkward.
- **Whether email confirmation is on is a server setting, and the client cannot tell you.**
  `mailer_autoconfirm` has **no supabase-js equivalent** — don't go looking for a flag. The app
  handles both: off means `signUp` returns a session immediately and `sign-up.tsx` skips
  straight to `create-family`; on means it shows the 6-digit verify step. **Do not assume which
  is live** — read it with `npm run auth:config` (or the unauthenticated
  `GET /auth/v1/settings`, where `mailer_autoconfirm: true` means confirmation is *off*), and
  flip it with `npm run auth:config -- --confirmations on|off`
  (`scripts/supabase-auth-config.mjs`, needs `SUPABASE_ACCESS_TOKEN`). It was being turned off
  for development, but the toggle is a dashboard click that this repo cannot record.
  It applies to **new** sign-ups only: accounts made while it was on stay unconfirmed forever,
  and `signInWithPassword` on one keeps failing `email_not_confirmed` no matter what the
  setting says afterwards.
- **The built-in SMTP sends about two emails per hour**, and every confirmation-on signup burns
  one — repeated signup testing hits `over_email_send_rate_limit` fast. Turning confirmation off
  sends no email at all, so the cap stops applying; a custom `smtp_host` is the other way out.
- **The OTP path is dormant, not deleted.** With confirmation on, `signUp` mints a 6-digit OTP
  *and* a confirmation URL wrapping the same token, and the project's "Confirm signup" email
  template — not the client — decides which the user sees.
  `supabase/templates/confirmation.html` renders `{{ .Token }}`; it is **not applied to the live
  project**, so re-enabling confirmation without it means links again (README sections 4–5).
  `verifyEmailOtp()` redeems the code with `type: 'signup'`, and the session it returns is what
  moves the user on — `sign-up.tsx` never navigates, exactly like the rest of the auth flow.
- **A duplicate sign-up is reported as success, not `EMAIL_TAKEN`.** With confirmation on,
  GoTrue returns an obfuscated user with `identities: []` and sends no email, so signup cannot
  be used to enumerate accounts. `signUpWithEmail` checks that empty list; without it the UI
  waits forever on a code that was never sent.
- **A wrong sign-up code and an expired one are the same 403 `otp_expired`** — GoTrue does not
  distinguish them, so the copy cannot either. Map that code explicitly; the `error.status === 403`
  fallback in `toAuthError` would otherwise report a mistyped digit as "Sign in to continue."

## Gotchas specific to this stack

- **React Navigation paints its own background behind every screen, and its stock themes are not ours.** `ThemeProvider`, `DefaultTheme`, `DarkTheme` and the `Theme` type are imported from **`@react-navigation/native`**, not `expo-router` — expo-router 7 (SDK 57) re-exported them, expo-router 6 does not, so an SDK 57 snippet importing them from `expo-router` will not compile. Their `DefaultTheme`/`DarkTheme` hardcode `background: rgb(242, 242, 242)` and `rgb(1, 1, 1)`, so passing them to `ThemeProvider` leaves a full-bleed grey (or pure black) view *under* the screens — no amount of `colors.background` on `Screen` fixes it, and it survives as a grey flash during transitions even where a screen covers it. `useNavigationTheme()` (`src/hooks/use-theme.ts`) rebuilds that theme from `Palette`; pass it to `ThemeProvider` and never hand the stock objects in. The tab navigator needs `sceneStyle: { backgroundColor: colors.background }` on top of that, because bottom-tabs paints a scene view of its own. Grep the served HTML for `rgba(242,242,242,1.00)` to catch a regression.

- **Typed routes are generated only by the dev server**, into `.expo/types/router.d.ts`; `expo export` does *not* refresh them. A **running** Metro picks up a new screen within a second or two of the file appearing — check with `grep -c my-route .expo/types/router.d.ts` before assuming otherwise. It is only with **no** dev server running that `router.push('/new-route')` fails typecheck with a misleading "not assignable" error; start Metro (or restart it) and re-run.
- **`StyleSheet.absoluteFill` is a registered style ID in RN 0.81, not an object.** Spreading it (`{ ...StyleSheet.absoluteFill }`) fails typecheck with "Spread types may only be created from object types" — use `...StyleSheet.absoluteFillObject` for that, and pass the bare `absoluteFill` only where a whole `style` is expected (`family-map.tsx`). RN 0.86 inverted this, so a snippet written against SDK 57 will be exactly backwards.
- **`tsconfig.json` excludes `supabase/functions`.** Edge Functions are Deno, not React Native — without the exclude, `include: ["**/*.ts"]` sweeps them into the app's type program and `npm run typecheck` fails on `Deno` globals and `jsr:` imports.
- **`expo-env.d.ts` must exist** (it is gitignored and regenerated by `expo start`). Without it, `tsconfig.json` cannot resolve the CSS-module and `*.css` declarations from `expo/types`, and typecheck fails on files the template itself ships.
- The template's `NativeTabs` (`expo-router/unstable-native-tabs`) was **deliberately replaced** with expo-router's JS `Tabs` so all five tabs theme identically across iOS and Android. Do not switch back.
- **The tab bar is a floating island, so it takes no space out of a screen.** `tabBarStyle` is `position: 'absolute'` (inset `Spacing.lg` each side, `Radius.pill`, `surfaceElevated`, `Shadow.floating`, icon-only via `tabBarShowLabel: false` — each screen's `title` still supplies the accessibility label; glyphs are `TAB_ICON_SIZE`, since the `size` react-navigation hands `tabBarIcon` is a fixed 25pt meant for a bar with labels, and they are centred by auto margins in `tabBarIconStyle` because `tabBarItemStyle` never reaches the `justifyContent: 'flex-start'` pressable that lays the icon out), which means the tab navigator reserves nothing for it and a scroll view runs the full height of the window. Every tab screen therefore pays the space back itself, from **one** source: `useTabBarMetrics()` (`src/hooks/use-tab-bar.ts`, metrics in `TabBar` in `src/theme/layout.ts`) returns the bar's `offset`/`height` and the `clearance` a screen owes it. `Screen` gets it as `contentContainerStyle={{ paddingBottom: clearance }}`, the Tasks FAB as its `bottom`, the Map's bottom stack as `paddingBottom`, and Chat as the composer's `bottomInset`. A new tab screen that forgets it ends underneath the pill. Chat additionally collapses that inset while the keyboard is up (the island is hidden or behind it) and passes `keyboardVerticalOffset={0}`, since the scene now reaches the bottom of the window; Android sets `tabBarHideOnKeyboard` because it resizes the window instead.
- `src/hooks/use-color-scheme.web.ts` sets state in an effect on purpose — that is the hydration-detection pattern, not a mistake. It carries no `eslint-disable`: `eslint-config-expo@10` ships eslint-plugin-react-hooks **5.x**, which has no `set-state-in-effect` rule, and naming an unknown rule in a disable comment is itself a lint **error** ("Definition for rule ... was not found"). Do not add one back unless the plugin gains the rule.
- Most screens use the shared `Screen` wrapper (safe-area insets, max content width). **Chat and Map intentionally do not**: Chat needs the composer pinned to the keyboard while only the message list scrolls, and Map needs a full-bleed `FamilyMap` behind the safe area.
- **Most of `package.json` is unused template baggage.** `react-native-reanimated`, `react-native-worklets`, `expo-symbols`, `expo-glass-effect`, `@expo/ui`, `expo-font`, `expo-splash-screen` and `expo-system-ui` are imported in **zero** files. (`expo-device` and `expo-constants` left that list when `notificationService` picked them up — `Device.isDevice` is how a simulator is told from hardware, and `Constants` is where the EAS project id lives.) (`expo-linking` and `expo-web-browser` were also dead until `authService` picked them up for the Google OAuth deep link — which is why no `expo-auth-session` dependency was added.) Every *navigation* transition is still stock, and layout is still static `StyleSheet`; every animation in the app is RN's own `Animated`, timed from `Motion` — `usePressScale`, `SwipeToComplete`, `ImageViewer`, `Sheet` (entrance, drag-dismiss and content swap), `ConfirmDialog`, `Segmented`'s sliding thumb and the task composer's disclosure rows. `react-native-reanimated` remains unused, so reach for `Animated` rather than waking it up. `react-native-gesture-handler` is used only for the root `GestureHandlerRootView`. The deliberate additions to this list are `expo-haptics`, `expo-linear-gradient`, `react-native-maps`, `expo-notifications` and the two the chat photo path needed, `expo-image-picker` and `expo-image-manipulator` — each reached through exactly one wrapper (`useHaptics`, `GradientSurface`, `FamilyMap`, `notificationService`, and `chatMediaService` for both of the last two) rather than imported at a call site — and `react-native-maps` is imported by `family-map.tsx` **only**, never by anything that a web bundle can reach. Don't assume this infrastructure is wired up, and don't add a dependency without checking it isn't already sitting there unused. **i18n added nothing** — no `i18next`, no `expo-localization`; `Intl` covers device locale and plural rules on every target (see the Language section), and reaching for a package now would be adding one to a list that is already too long.
