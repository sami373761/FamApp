/**
 * English — the source of truth for the key set.
 *
 * `TranslationKey` is derived from this object, so a key that is not here does
 * not exist, and the other nine catalogs are typed as `Translations` and will
 * not compile until they cover every one of them. Adding a string to the app is
 * therefore: add it here, then fix ten type errors.
 *
 * Keys are flat and dotted (`profile.editAvatar`) rather than nested. Flat means
 * one lookup, no path walking, and a key union TypeScript can actually print in
 * an error message.
 *
 * A value is either a string or a `PluralForms` object. The object form is what
 * `count` selects between — see `pluralise` in `../index.ts`. English needs two
 * forms; Russian needs four and Turkish one, and each catalog supplies its own.
 *
 * `{{name}}` placeholders are substituted verbatim. Word order inside a string
 * is the translator's to change; the placeholders just have to survive.
 */

import type { PluralForms } from '@/i18n/types';

export const en = {
  // Shared words. Kept few on purpose — a "common" bucket that grows becomes a
  // place where the same English word is reused for two different meanings that
  // some other language distinguishes.
  'common.cancel': 'Cancel',
  'common.you': 'You',
  'common.someone': 'Someone',
  'common.anyone': 'Anyone',
  'common.me': 'Me',
  'common.loading': 'Loading…',
  'common.or': 'or',
  'common.photo': 'Photo',
  'common.admin': 'Admin',
  'common.skip': 'Skip',
  'common.signOut': 'Sign out',
  'common.goBack': 'Go back',
  'common.dismiss': 'Dismiss {{title}}',
  'common.close': 'Close',
  'common.unnamedMember': 'Unnamed member',
  'common.unnamedFamily': 'Unnamed',
  'common.yourFamily': 'Your family',

  // Tab titles. Hidden under the icons, but they are still each tab's
  // accessibility label.
  'tabs.home': 'Home',
  'tabs.chat': 'Chat',
  'tabs.map': 'Map',
  'tabs.tasks': 'Tasks',
  'tabs.profile': 'Profile',

  // Relative time, derived in `data/format.ts` from a real `timestamptz`.
  'time.now': 'now',
  'time.minutesAgo': { one: '{{count}} min ago', other: '{{count}} min ago' } as PluralForms,
  'time.hoursAgo': { one: '{{count}} h ago', other: '{{count}} h ago' } as PluralForms,
  'time.yesterday': 'yesterday',
  'time.daysAgo': { one: '{{count}} day ago', other: '{{count}} days ago' } as PluralForms,
  'time.today': 'Today',
  'time.yesterdayLabel': 'Yesterday',

  // A task's deadline — `expires_at` is the only time a task carries.
  'due.expired': 'Expired',
  'due.inMinutes': { one: 'Due in {{count}} min', other: 'Due in {{count}} min' } as PluralForms,
  'due.today': 'Due today · {{time}}',
  'due.tomorrow': 'Due tomorrow · {{time}}',
  'due.inDays': { one: 'Due in {{count}} day', other: 'Due in {{count}} days' } as PluralForms,

  // How fresh a `locations` row is.
  'presence.live': 'Live',
  'presence.recent': 'Recently seen',
  'presence.stale': 'Stale',

  // `profiles.role` — a self-declared label, never a permission.
  'role.parent': 'Parent',
  'role.child': 'Child',
  'role.guardian': 'Guardian',

  // The four values `tasks_status_valid` allows.
  'taskStatus.pending': 'Pending',
  'taskStatus.inProgress': 'In progress',
  'taskStatus.completed': 'Done',
  'taskStatus.expired': 'Expired',

  'welcome.getStarted': 'Get started',
  'welcome.haveAccount': 'I already have an account',

  'signIn.title': 'Sign in',
  'signIn.heading': 'Welcome back',
  'signIn.subtitle': 'Sign in to get back to your family.',
  'signIn.email': 'Email',
  'signIn.emailPlaceholder': 'you@example.com',
  'signIn.password': 'Password',
  'signIn.passwordPlaceholder': 'Your password',
  'signIn.submit': 'Sign in',
  'signIn.google': 'Continue with Google',
  'signIn.newHere': 'New here? ',
  'signIn.createAccount': 'Create an account',

  'signUp.title': 'Create account',
  'signUp.heading': 'Create your account',
  'signUp.subtitle': 'You will set up or join a family next.',
  'signUp.passwordPlaceholder': 'At least {{count}} characters',
  'signUp.passwordTooShort': 'Use at least {{count}} characters.',
  'signUp.submit': 'Create account',
  'signUp.google': 'Continue with Google',
  'signUp.haveAccount': 'Already have an account? ',
  'signUp.signIn': 'Sign in',
  'signUp.verifyTitle': 'Verify email',
  'signUp.changeEmail': 'Change email',
  'signUp.verifyHeading': 'Enter your code',
  'signUp.verifySubtitle': 'We sent a {{length}}-digit code to {{email}}. It expires in an hour.',
  'signUp.codeLabel': 'Verification code',
  'signUp.verify': 'Verify',
  'signUp.resend': 'Send a new code',
  'signUp.resendIn': 'Send a new code ({{seconds}}s)',
  'signUp.resentNotice': 'A new code is on its way to {{email}}.',

  // Shared by the onboarding pair and by `add-family`.
  'family.yourNameLabel': 'YOUR NAME',
  'family.yourNamePlaceholder': 'How your family sees you',
  'family.colorLabel': 'AVATAR COLOUR',
  'family.colorOption': 'Avatar colour {{number}}',
  'family.codeComplete': 'Code complete',
  'family.codeProgress': '{{typed}} of {{length}} characters',
  'family.codeInputA11y': 'Family code, {{length}} characters',

  'createFamily.title': 'Create family',
  'createFamily.heading': 'Start your family space',
  'createFamily.subtitle':
    'Pick a name everyone will recognise. You can invite members right after.',
  'createFamily.familyNameLabel': 'FAMILY NAME',
  'createFamily.familyNamePlaceholder': 'Your family name',
  'createFamily.note': 'A 6-character invite code is generated once your family is created.',
  'createFamily.haveCode': 'I have a code instead',
  'createFamily.skip': 'Skip for now — just open the app',
  'createFamily.submit': 'Create family',

  'joinFamily.title': 'Join family',
  'joinFamily.heading': 'Enter your family code',
  'joinFamily.subtitle':
    'Ask a family member for the 6-character code shown in their profile.',
  'joinFamily.hintTitle': 'Where do I find the code?',
  'joinFamily.hintBody': 'Any member can read it from their profile. A family is full at 10 people.',
  'joinFamily.createInstead': 'Create a new family instead',
  'joinFamily.submit': 'Join family',

  'avatarBuilder.title': 'Your avatar',
  'avatarBuilder.heading': 'Pick your memoji',
  'avatarBuilder.subtitle':
    'Your family sees this on the map, in chat and next to every task. Shuffle until one feels like you.',
  'avatarBuilder.save': 'Save avatar',
  'editAvatar.title': 'Edit avatar',

  'memoji.failed': 'Could not load this memoji',
  'memoji.imageA11y': 'Your memoji',
  'memoji.shuffleA11y': 'Shuffle avatar',
  'memoji.shuffle': 'Shuffle',

  'addFamily.title': 'Add a family',
  'addFamily.modeCreate': 'Start a family',
  'addFamily.modeJoin': 'Use a code',
  'addFamily.modeLabel': 'How to add a family',
  'addFamily.headingCreate': 'Start your family space',
  'addFamily.headingJoin': 'Join an existing family',
  'addFamily.subtitleCreate': 'You will be its admin, and you get an invite code to share.',
  'addFamily.subtitleJoin': 'Ask a member for the 6-character code from their Profile tab.',
  'addFamily.previewLabel': 'THEY WILL SEE YOU AS',
  'addFamily.previewMemoji': 'Your memoji comes with you',
  'addFamily.previewInitials': 'Your initials, in your colour',
  'addFamily.sectionFamily': 'The family',
  'addFamily.sectionCode': 'The code',
  'addFamily.sectionYou': 'You',
  'addFamily.familyNameLabel': 'Family name',
  'addFamily.familyNamePlaceholder': 'Something everyone recognises',
  'addFamily.yourNameLabel': 'Your name',
  'addFamily.colorLabel': 'YOUR COLOUR',
  'addFamily.colorHint': 'Your pin on the map and the dot beside your name.',
  'addFamily.roleLabel': 'ROLE',
  'addFamily.roleHint': 'A label for your family, not a permission.',
  'addFamily.noteCreate':
    'A 6-character invite code is generated once the family exists. A family holds up to 10 people.',
  'addFamily.noteJoin':
    'Your chat, tasks and map become shared with everyone already in that family.',
  'addFamily.nameRange': 'Between {{min}} and {{max}} characters.',

  'editProfile.title': 'Edit profile',
  'editProfile.heading': 'How your family sees you',
  'editProfile.nameLabel': 'Display name',
  'editProfile.namePlaceholder': 'Your name',
  'editProfile.nameRange': 'Between {{min}} and {{max}} characters.',
  'editProfile.nameInvalid': 'Your name needs to be between {{min}} and {{max}} characters.',
  'editProfile.roleLabel': 'ROLE',
  'editProfile.roleHint': 'A label for your family, not a permission. Admin rights are separate.',
  'editProfile.save': 'Save changes',

  'manageMembers.title': 'Members',
  'manageMembers.loading': 'Loading your family…',
  'manageMembers.placesUsed': '{{used}} of {{max}} places used.',
  'manageMembers.memberCount': {
    one: '{{count}} member.',
    other: '{{count}} members.',
  } as PluralForms,
  'manageMembers.adminHint': 'Removing someone clears their family, and they keep their account.',
  'manageMembers.memberHint': 'Only a family admin can remove members.',
  'manageMembers.emptyTitle': 'No members yet',
  'manageMembers.emptyBody': 'Share your invite code from the Profile tab to bring someone in.',
  'manageMembers.notAdmin':
    'You are a member of this family. Ask an admin if someone needs to be removed.',
  'manageMembers.removeTitle': 'Remove {{name}}?',
  'manageMembers.removeTitleGeneric': 'Remove member?',
  'manageMembers.removeMessage':
    "They lose access to this family's chat, tasks and map straight away. Their account stays, and they can join another family with a code.",
  'manageMembers.remove': 'Remove',
  'manageMembers.codeTitle': 'Invite code',
  'manageMembers.codeBody': 'Anyone who has it can join, until you replace it.',
  'manageMembers.regenerate': 'Regenerate',
  'manageMembers.regenerateTitle': 'Regenerate the invite code?',
  'manageMembers.regenerateMessage':
    'The current code stops working immediately, so anyone you have already sent it to will need the new one. Members already in the family are not affected.',
  'memberRow.joined': 'Joined {{date}}',
  'memberRow.removeA11y': 'Remove {{name}}',

  'home.welcome': 'Welcome back',
  'home.statusFamily': 'Family',
  'home.statusLoading': 'Loading your family…',
  'home.statusOverdue': 'Overdue',
  'home.statusDueToday': 'Due today',
  'home.statusLive': 'Live now',
  'home.statusLiveDetail': '{{name}} · updated {{time}}',
  'home.statusSolo': 'Just you',
  'home.statusSoloDetail': 'Create or join a family',
  'home.memberCount': { one: '{{count}} member', other: '{{count}} members' } as PluralForms,
  'home.rosterSharing': '{{roster}} · {{count}} sharing a position',
  'home.rosterNobody': '{{roster}} · nobody sharing yet',
  'home.nextUp': 'Next up',
  'home.noOpenTasks': 'No open tasks',
  'home.completedCount': {
    one: '{{count}} completed',
    other: '{{count}} completed',
  } as PluralForms,
  'home.latestMeta': '{{name}} · {{time}}',
  'home.latest': 'Latest',
  'home.noMessages': 'No messages yet',
  'home.sayHello': 'Say hello to your family',
  'home.activity': 'Activity',
  'home.activityLoading': 'Loading activity…',
  'home.activityEmptyTitle': 'Nothing has happened yet',
  'home.activityEmptyBody': 'Messages and new tasks show up here as your family uses the app.',

  'presenceTile.title': 'Where everyone is',
  'presenceTile.nobody': 'Nobody to place yet',
  'presenceTile.sharingCount': '{{sharing}} of {{total}} sharing a position',
  'presenceTile.locate': 'Locate',
  'presenceTile.locateA11y': 'Share my location now',
  'presenceTile.loading': 'Loading your family…',
  'presenceTile.noMembers': 'No members yet',
  'presenceTile.noFamily': 'No family yet',
  'presenceTile.noMembersBody': 'Share your invite code from the Profile tab to bring people in.',
  'presenceTile.noFamilyBody':
    'Create or join a family from the Profile tab to share where you are.',
  'presenceTile.memberA11y': '{{name}} on the map',
  'presenceTile.noLocation': 'No location',

  'chat.title': 'Family chat',
  'chat.memberCount': { one: '{{count}} member', other: '{{count}} members' } as PluralForms,
  'chat.online': ' · {{count}} online',
  'chat.loading': 'Loading messages…',
  'chat.emptyTitle': 'No messages yet',
  'chat.emptyBody': 'Say hello — your family will see it on their Home tab too.',
  'chat.composerPlaceholder': 'Message your family',
  'chat.addA11y': 'Add to the chat',
  'chat.addHint': 'Create a task or send a photo',
  'chat.sendA11y': 'Send message',
  'chat.photoA11y': 'Photo from {{name}}',
  'chat.photoFailed': 'This photo could not be loaded',
  'chat.photoOpenHint': 'Opens the photo full screen',
  'chat.photoSending': 'Sending this photo…',
  'chat.photoClose': 'Close photo',
  'chat.photoUploading': 'Sending photo…',
  'chat.actionsHint': 'Long press for message options',
  'chat.deleteTitle': 'Delete this message?',
  'chat.deleteMessage': 'It disappears for everyone in your family, and a photo is deleted with it. This cannot be undone.',
  'chat.deleteConfirm': 'Delete message',

  'photoComposer.previewA11y': 'The photo you picked',
  'photoComposer.captionLabel': 'Caption',
  'photoComposer.captionPlaceholder': 'Add a caption…',
  'photoComposer.hint': 'Nothing is sent until you tap Send.',
  'photoComposer.send': 'Send',

  'chatActions.title': 'Add to the chat',
  'chatActions.createTask': 'Create task',
  'chatActions.createTaskHint': 'Assign it, set a deadline, and post it here',
  'chatActions.createTaskDisabled': 'Create or join a family from Profile first',
  'chatActions.sendPhoto': 'Send photo',
  'chatActions.sendPhotoHint': 'Pick one from your library and post it here',
  'chatActions.sendPhotoLocked': 'FamApp Gold required',
  'chatActions.sendPhotoDisabled': 'Create or join a family from Profile first',

  'messageActions.title': 'Message',
  'messageActions.createTask': 'Create task from message',
  'messageActions.createTaskHint': 'Opens the task form with this text as the title',
  'messageActions.createTaskNoText': 'This message has no text to use as a title',
  'messageActions.delete': 'Delete message',
  'messageActions.deleteHint': 'Remove it for everyone in your family',

  'taskMessage.youAdded': 'You added a task',
  'taskMessage.someoneAdded': '{{name}} added a task',

  'task.setStatusA11y': 'Set {{title}} to {{status}}',
  'task.lockedHint': 'Only {{name}} can update this',

  'map.noFamily': 'Join or create a family to share where you are.',
  'map.sharingOff': 'Location sharing is off. Turn it back on from Profile.',
  'map.locateA11y': 'Share my location now',

  'places.categoryHome': 'Home',
  'places.categorySchool': 'School',
  'places.categoryWork': 'Work',
  'places.categoryLeisure': 'Leisure',
  'places.categoryPark': 'Park',
  'places.at': '{{name}} at {{place}}',
  'places.atOwned': "{{name}} at {{owner}}'s {{place}}",
  'places.atYours': '{{name}} at your {{place}}',
  'places.addTitle': 'Save a place',
  'places.editTitle': 'Edit place',
  'places.detailsTitle': 'Saved place',
  'places.deleteTitle': 'Delete this place?',
  'places.deleteMessage': '{{title}} disappears from everyone in the family.',
  'places.categoryLabel': 'What kind of place is it?',
  'places.categoryHint': 'One of each — pick another kind to save a second place.',
  'places.allSaved': 'You have saved all five kinds. Edit one of them instead.',
  'places.titleLabel': 'Name',
  'places.titlePlaceholder': 'Beach Park',
  'places.pinAt': 'Pin at {{coordinates}}',
  'places.moveHint': 'Press and hold anywhere on the map to move the pin.',
  'places.save': 'Save place',
  'places.saveChanges': 'Save changes',
  'places.edit': 'Edit',
  'places.delete': 'Delete',
  'places.savedByYou': 'Saved by you',
  'places.savedBy': 'Saved by {{name}}',
  'places.savedBySomeone': 'Saved by a member who has since left',
  'places.addA11y': 'Save a place',
  'places.addByPressA11y': 'Press and hold to save a place here',
  'places.draftA11y': 'The place you are saving',
  'places.limitTitle': 'No room for another place',
  'places.limitCount': '{{saved}} of {{limit}} places saved',
  'places.limitFreeBody': 'A free family can save {{limit}} places between everyone. FamApp Gold raises that to {{gold}}.',
  'places.limitGoldBody': 'Your family has saved as many places as FamApp Gold allows. Delete one to make room.',
  'places.limitUpgrade': 'See FamApp Gold',

  'drawer.hide': 'Hide the family list',
  'drawer.show': 'Show the family list',
  'drawer.updated': 'Updated {{time}}',
  'drawer.loading': 'Loading positions…',
  'drawer.emptyTitle': 'Nobody is sharing their location',
  'drawer.emptyBodyFamily':
    'Pins appear here once a family member starts sharing where they are.',
  'drawer.emptyBodySolo': 'A map needs somebody to share it with.',
  'drawer.centreA11y': 'Centre the map on {{name}}',
  'drawer.notSharingA11y': '{{name}} is not sharing a location',
  'drawer.selfName': '{{name}} · You',
  'drawer.position': '{{coordinates}} · {{time}}',
  'drawer.notSharing': 'Not sharing location',

  'tasks.title': 'Tasks',
  'tasks.counts': '{{open}} open · {{completed}} completed',
  'tasks.filterAll': 'All tasks',
  'tasks.filterMine': 'Assigned to me',
  'tasks.sectionPending': 'Pending',
  'tasks.sectionCompleted': 'Completed',
  'tasks.loading': 'Loading tasks…',
  'tasks.emptyMine': 'Nothing assigned to you',
  'tasks.emptyAll': 'No open tasks',
  'tasks.emptyMineBody': 'Tasks assigned to you will show up here.',
  'tasks.emptyAllBody': 'Tap + to add the first one, or create it from the Chat tab.',
  'tasks.emptyNoFamilyBody': 'Create or join a family from Profile to start sharing tasks.',
  'tasks.noCompleted': 'No completed tasks yet',
  'tasks.addA11y': 'Add a task',

  'composer.title': 'New task',
  'composer.description': 'It appears in the family chat and on the Tasks tab.',
  'composer.taskLabel': 'Task',
  'composer.taskPlaceholder': 'What needs doing?',
  'composer.assignLabel': 'ASSIGN TO',
  'composer.assignPool': 'Unassigned tasks sit in the pool for anyone to pick up.',
  'composer.assignPerson': 'They will see it under “Assigned to me”.',
  'composer.dueLabel': 'DUE',
  'composer.durationDay': 'Tomorrow',
  'composer.durationWeek': 'In a week',
  'composer.durationMonth': 'In a month',
  'composer.expires': 'Expires {{date}}',
  'composer.noteLabel': 'Note (optional)',
  'composer.notePlaceholder': 'Anything the family should know',
  'composer.noteHint': 'A note is sent as your own message in the chat, just above the task.',
  'composer.submit': 'Create task',

  'profile.loading': 'Loading your profile…',
  'profile.statFamily': 'Family',
  'profile.statSolo': 'Just you',
  'profile.statSince': 'Member since',
  'profile.statTasksDone': 'Tasks done',
  'profile.inviteTitle': 'Family invite code',
  'profile.inviteBody': 'Share this so others can join',
  'profile.sectionAccount': 'Account',
  'profile.editProfile': 'Edit profile',
  'profile.editProfileHint': 'Your display name and role',
  'profile.editAvatar': 'Edit avatar',
  'profile.editAvatarHint': 'Shuffle for a new memoji',
  'profile.sectionFamily': 'Family',
  'profile.manageMembers': 'Manage members',
  'profile.manageMembersCount': '{{count}} of {{max}} people',
  'profile.manageMembersCountOnly': {
    one: '{{count}} person',
    other: '{{count}} people',
  } as PluralForms,
  'profile.manageMembersNotAdmin': 'Only a family admin can remove members',
  'profile.addFamily': 'Create or join a family',
  'profile.addFamilyHint': 'You are using FamApp on your own',
  'profile.sectionPreferences': 'Preferences',
  'profile.notifications': 'Notifications',
  'profile.notificationsHint': 'This device only',
  'profile.locationSharing': 'Location sharing',
  'profile.locationSharingHint': 'Turning this off deletes your last position',
  'profile.appearance': 'Appearance',
  'profile.appearanceHint': 'System follows your device setting',
  'profile.appearanceSystem': 'System',
  'profile.appearanceLight': 'Light',
  'profile.appearanceDark': 'Dark',
  'profile.language': 'Language',
  'profile.sectionActions': 'Account actions',
  'profile.signOut': 'Sign out',
  'profile.deleteAccount': 'Delete account',
  'profile.deleteAccountHint': 'Permanent — this cannot be undone',
  'profile.deleteTitle': 'Delete your account?',
  'profile.deleteMessageAdmin':
    'Your profile, messages and the tasks you created are deleted. Your family carries on — another member takes over as admin.',
  'profile.deleteMessage':
    'Your profile, messages and the tasks you created are deleted, along with the family if you are its last member. This cannot be undone.',
  'profile.version': 'FamApp · Prototype build 1.0.0',

  /*
    FamApp Gold — the paywall, its banner on Home and its row on Profile.

    The one mock in the app: there is no subscription table and no store, so
    the prices below are copy rather than anything fetched. They stay in US
    dollars in all ten catalogs for exactly that reason — a localised price
    with no store behind it would be a number invented twice. The product
    names ("FamApp", "Gold") are not translated, like "FamApp" everywhere else.
  */
  'premium.name': 'FamApp Gold',
  'premium.badge': 'Gold',
  'premium.bannerTitle': 'Upgrade to FamApp Gold',
  'premium.bannerBody': 'Room for 10, photos in chat and arrival alerts',
  'premium.rowLabel': 'FamApp Gold',
  'premium.rowHint': 'More members, more tasks, photos and alerts',
  'premium.title': 'More room for the whole family',
  'premium.subtitle': 'One subscription, for everyone in your family.',
  'premium.benefits': 'What you get',
  'premium.benefitMembers': 'Up to 10 family members',
  'premium.benefitMembersBody': 'A free family holds 5. Gold makes room for 10.',
  'premium.benefitPhotos': 'Photos in the family chat',
  'premium.benefitPhotosBody': 'The free chat is text only. Gold adds photo sharing to the group chat.',
  'premium.benefitTasks': '10 active tasks each',
  'premium.benefitTasksBody': 'Free gives every member 2 tasks at a time. Gold raises that to 10.',
  'premium.benefitAlerts': 'Arrival and departure alerts',
  'premium.benefitAlertsBody': 'Get a notification when someone reaches or leaves a saved place. Seeing where the family is stays free for everyone.',
  'premium.plans': 'Choose your plan',
  'premium.planAnnual': 'Annual',
  'premium.planAnnualPrice': '$39.99 / year',
  'premium.planAnnualPer': 'Works out at $3.33 a month',
  'premium.planAnnualBadge': 'Best value · 40% off',
  'premium.planAnnualTrial': 'Includes a 7-day free trial',
  'premium.planMonthly': 'Monthly',
  'premium.planMonthlyPrice': '$4.99 / month',
  'premium.planMonthlyPer': 'Billed every month',
  'premium.ctaTrial': 'Start 7-day free trial',
  'premium.ctaMonthly': 'Continue with Monthly',
  'premium.footnote': 'Cancel anytime. One subscription covers all family members.',
  'premium.a11ySelect': 'Choose the {{plan}} plan',
  'premium.activeBadge': 'Active',
  'premium.activeTitle': 'Your family is on Gold',
  'premium.activeSubtitle': 'Everyone in the family has it, on every device.',
  'premium.until': 'Runs until {{date}}',
  'premium.noEndDate': 'No end date is recorded for this subscription.',
  'premium.expiredTitle': "Your family's Gold has run out",
  'premium.expiredOn': 'It ran out on {{date}}',
  'premium.benefitsActive': 'What your family gets',
  'premium.benefitPlaces': '10 saved places',
  'premium.benefitPlacesBody': 'A free family saves 2 places between everyone. Gold raises that to 10.',
  'premium.ctaRenew': 'Renew FamApp Gold',
  'premium.restore': 'Restore purchase',
  'premium.restored': 'Your subscription is up to date.',
  'premium.confirmed': 'FamApp Gold is on for your family.',
  'premium.rowHintActive': 'Active for everyone in your family',

  'language.title': 'Language',
  'language.description': 'FamApp uses this on this device only, like your appearance setting.',
  'language.system': 'Match my device',
  'language.systemDetail': 'Currently {{language}}',
  'language.a11y': 'Use {{language}}',

  // The feed on Home, folded from messages and task creations.
  'activity.message': '{{name}}: {{preview}}',
  'activity.photo': '{{name}} shared a photo',
  'activity.task': '{{name}} added “{{title}}”',

  'avatar.a11y': '{{initials}} avatar',

  /*
    Service failures. `services/` names the key and never the sentence, so the
    copy is resolved where the language is known — at render, in the screen. The
    database's own messages ("This family is full (10 of 10 members)") are
    written server-side and still come through as English; there is no client
    fix for those short of a column of message codes.
  */
  'errors.unknown': 'Something went wrong. Try again.',
  'errors.offline': 'No connection. Check your network and try again.',
  'errors.notAuthenticated': 'Sign in to continue.',

  'errors.auth.invalidCredentials': 'That email and password do not match.',
  'errors.auth.emailNotConfirmed': 'Confirm your email address first — check your inbox.',
  'errors.auth.emailTaken': 'An account already exists for that email.',
  'errors.auth.emailTakenSignIn': 'An account already exists for that email. Sign in instead.',
  'errors.auth.invalidEmail': 'That email address is not valid.',
  'errors.auth.weakPassword': 'Choose a stronger password.',
  'errors.auth.invalidOtp': 'That code is incorrect or has expired. Send a new one.',
  'errors.auth.otpDisabled': 'Email codes are not enabled for this app.',
  'errors.auth.emailRateLimited':
    'Too many confirmation emails were sent to this address. Supabase allows about two per hour — wait, or turn off email confirmation for development.',
  'errors.auth.rateLimited': 'Too many attempts. Wait a minute and try again.',
  'errors.auth.signupsDisabled': 'New sign-ups are currently disabled.',
  'errors.auth.providerDisabled': 'That sign-in method is not enabled for this app.',
  'errors.auth.googleDisabled': 'Google sign-in is not enabled for this app yet.',
  'errors.auth.oauthCancelled': 'Google sign-in was cancelled.',
  'errors.auth.deleteUnavailable': 'Account deletion is not set up on this project yet.',

  'errors.chat.tooLong': 'Messages are limited to {{max}} characters.',
  'errors.chat.empty': 'Type something first.',
  'errors.chat.systemEmpty': 'A system message needs content.',
  'errors.chat.notMember': 'You are not a member of this family.',
  'errors.chat.mediaMissing': 'That photo was not stored. Try sending it again.',
  'errors.chat.deleteRefused': 'That message could not be deleted.',

  'errors.family.forbidden': 'You do not have permission to do that.',
  'errors.family.notFound': 'That family could not be found.',
  'errors.family.notCreated': 'The family was not created. Try again.',
  'errors.family.codeRequired': 'Enter the 6-character code from your family.',
  'errors.family.codeNotFound': 'No family found for code {{code}}.',
  'errors.family.codeNotChanged': 'The invite code was not changed. Try again.',
  'errors.family.none': 'You are not in a family yet.',

  'errors.location.permissionNeeded': 'Location permission is needed to share where you are.',
  'errors.location.permissionDenied':
    'Location permission is off. Turn it on in your device settings.',
  'errors.location.unavailable': 'Your location could not be found. Try again.',
  'errors.location.loadFailed': 'Locations could not be loaded.',
  'errors.location.shareFailed': 'Your location could not be shared.',
  'errors.location.clearFailed': 'Location sharing could not be turned off.',

  'errors.push.permissionNeeded': 'Notification permission is needed to send you alerts.',
  'errors.push.permissionDenied': 'Notifications are off. Turn them on in your device settings.',
  'errors.push.unsupportedWeb': 'Notifications are not available in the browser yet.',
  'errors.push.unsupportedSimulator': 'Notifications need a real device — a simulator cannot receive them.',
  'errors.push.unsupportedDevice': 'This device cannot receive notifications.',
  'errors.push.notConfigured': 'Notifications are not set up for this build yet.',
  'errors.push.tokenUnavailable': 'This device could not be registered for notifications. Try again.',
  'errors.push.saveFailed': 'This device could not be registered for notifications.',
  'errors.push.clearFailed': 'Notifications could not be turned off.',

  'errors.media.libraryDenied':
    'Photo access is off. Turn it on in your device settings to send a photo.',
  'errors.media.cameraDenied': 'Camera access is off. Turn it on in your device settings.',
  'errors.media.cameraUnsupported': 'The camera is not available in the browser.',
  'errors.media.processingFailed': 'That photo could not be prepared. Try another one.',
  'errors.media.uploadFailed': 'The photo could not be sent. Try again.',
  'errors.media.tooLarge': 'That photo is too large to send.',
  'errors.media.notMember': 'You are not a member of this family.',
  'errors.media.notFound': 'That photo is no longer available.',

  'errors.place.categoryTaken': 'You have already saved a place of that kind. Edit it instead.',
  'errors.place.titleTooLong': 'A place name can be at most {{max}} characters.',
  'errors.place.notMember': 'You need to be in this family to save a place.',
  'errors.place.notFound': 'That place is gone, or it is not yours to change.',
  'errors.place.loadFailed': 'Saved places could not be loaded.',
  'errors.place.saveFailed': 'That place could not be saved.',
  'errors.place.limitReached': 'Your family has saved as many places as its plan allows.',
  'errors.premium.noFamily': 'You need a family before you can subscribe.',
  'errors.premium.invalidPlan': 'That plan is not available.',
  'errors.premium.failed': 'The subscription could not be updated.',
  'errors.premium.nothingToRestore': 'There is no FamApp Gold purchase to restore for your family.',
  'errors.premium.unavailable': 'FamApp Gold is not available on this server yet.',

  'errors.task.titleTooLong': 'Give the task a title of up to {{max}} characters.',
  'errors.task.notMember': 'You are not a member of this family.',
  'errors.task.notPosted': 'The task was created, but it could not be posted to the chat.',
  'errors.task.noteFailed': 'The task was created and posted, but your note could not be sent.',

  /** The `system` message that announces a task in the chat. */
  'system.newTask': 'New task: “{{title}}”',
};

/** Every key the app may ask for. Derived, so it cannot drift from the catalog. */
export type TranslationKey = keyof typeof en;

/**
 * The shape every other language must fill. A key whose English value is a
 * plural object stays a plural object; everything else is a plain string.
 */
export type Translations = {
  [K in TranslationKey]: (typeof en)[K] extends string ? string : PluralForms;
};
