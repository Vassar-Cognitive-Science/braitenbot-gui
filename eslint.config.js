// @ts-check
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  // --- global ignores ---
  {
    ignores: [
      'dist/**',
      'docs/**',       // separate Docusaurus package — not part of the app
      'src-tauri/**',  // Rust code — no JS/TS to lint
      'node_modules/**',
    ],
  },

  // --- TypeScript source (app + vite config) ---
  {
    files: ['src/**/*.{ts,tsx}', 'vite.config.ts'],
    extends: [
      ...tseslint.configs.recommended,
      // react-hooks flat config (v7+)
      reactHooks.configs['flat']['recommended-latest'],
    ],
    plugins: {
      'react-refresh': reactRefresh,
    },
    rules: {
      // react-refresh: warn on non-component exports in component files
      ...reactRefresh.configs.vite.rules,
    },
  },

  // --- Plain JS/MJS utility scripts ---
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        // Node.js globals (no browser APIs needed)
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
      },
    },
  },
);
