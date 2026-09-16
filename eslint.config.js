// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    /*
      `supabase/functions` is ignored for the same reason `tsconfig.json`
      excludes it: Edge Functions are Deno, not React Native. Their `jsr:` and
      `https:` imports are resolvable by Deno alone, so the app's resolver
      reports every one of them as a missing module.
    */
    ignores: ['dist/*', 'expo-env.d.ts', 'supabase/functions/**'],
  },
]);
