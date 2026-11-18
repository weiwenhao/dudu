// https://docs.expo.dev/guides/using-eslint/
import { defineConfig } from 'eslint/config';
import expoConfig from 'eslint-config-expo/flat.js';

export default defineConfig([
  expoConfig,
  {
    ignores: ['dist/**', '.local/**', 'ios/**', 'android/**', 'src/generated/**', 'packages/oar-adapter/.generated/**',
      'packages/dsh-computer-use/vendor/**', 'packages/dsh-computer-use/.generated/**'],
  },
  {
    // Host modules are supplied by DSH, not installed again in the repository.
    files: ['packages/dsh-computer-use/entry.mjs'],
    rules: { 'import/no-unresolved': ['error', { ignore: ['^@deepseek-ai/'] }] },
  },
  {
    // The MCP SDK is reached by subpaths of its `exports` map (client/auth.js, ...), which the import resolver does not read; node and esbuild do.
    files: ['host/assistant/connectors/**/*.mjs'],
    rules: { 'import/no-unresolved': ['error', { ignore: ['^@modelcontextprotocol/sdk/'] }] },
  },
  {
    files: ['host/dudu-plugin/client.js', 'host/dudu-plugin/ui/entry.jsx'],
    languageOptions: {
      globals: { __DUDU_UI__: 'readonly', __DUDU_CSS__: 'readonly' },
    },
  },
]);
