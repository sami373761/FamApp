# Expo HAS CHANGED

This project is on **SDK 57** — `expo` 57.0.x, `expo-router` 7, React Native 0.86,
React 19.2, TypeScript 6.0. Read the versioned docs at
https://docs.expo.dev/versions/v57.0.0/ before writing any code.

**Do not follow SDK 54 / RN 0.81 snippets.** They are not merely older here, they
are wrong in at least three places this repo has already been bitten by — and the
first two are *inversions*, so an older snippet is exactly backwards rather than
merely stale:

- `ThemeProvider`, `DefaultTheme`, `DarkTheme` and `Theme` come from
  **`expo-router`**, which vendors React Navigation in v7.
  `@react-navigation/native` is not a dependency of this project at all, so an
  SDK 54 snippet importing from it will not resolve.
- `StyleSheet.absoluteFill` is a plain object in RN 0.86, so spread it directly.
  **`absoluteFillObject` no longer exists** — neither in the typings nor at
  runtime — which makes an SDK 54 snippet exactly backwards.
- `Tabs` is imported from **`expo-router/js-tabs`**. The `Tabs` still exported
  from `expo-router` itself is deprecated in v7.

React Compiler is **on** (`app.json` → `experiments.reactCompiler`), and
`eslint-config-expo@57` ships eslint-plugin-react-hooks **6.x**, whose compiler
rules (`react-hooks/refs`, `set-state-in-effect`, `purity`,
`preserve-manual-memoization`) are errors. They change which idioms compile
cleanly — see the "Gotchas specific to this stack" section of CLAUDE.md before
assuming any API shape.
