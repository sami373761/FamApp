# Expo HAS CHANGED

This project is on **SDK 54** — `expo` 54.0.x, `expo-router` 6, React Native 0.81,
React 19.1. Read the versioned docs at https://docs.expo.dev/versions/v54.0.0/
before writing any code.

**Do not follow SDK 57 / RN 0.86 snippets.** They are not merely newer here, they
are wrong in at least two places this repo has already been bitten by:

- `ThemeProvider`, `DefaultTheme`, `DarkTheme` and `Theme` come from
  `@react-navigation/native`. expo-router 7 re-exports them; expo-router 6 does
  not, so an SDK 57 snippet importing them from `expo-router` will not compile.
- `StyleSheet.absoluteFill` is a registered style ID in RN 0.81, so spreading it
  fails typecheck — use `absoluteFillObject`. RN 0.86 inverted this, which makes
  a v57 snippet exactly backwards.

See the "Gotchas specific to this stack" section of CLAUDE.md before assuming any
API shape.
