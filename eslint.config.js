// @ts-check
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "drizzle/migrations/**"] },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `_`-prefixed names are deliberately unused (Express error handlers, destructuring).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  // Node: server, shared code, scripts, tests and tool configs.
  {
    files: [
      "server/**/*.ts",
      "shared/**/*.ts",
      "scripts/**/*.{ts,mjs}",
      "tests/**/*.ts",
      "drizzle/**/*.ts",
      "*.config.{ts,js}",
    ],
    languageOptions: { globals: globals.node },
  },
  // Unhandled promises crash or silently drop work in a long-lived server, so check them with types.
  {
    files: ["server/**/*.ts", "shared/**/*.ts", "scripts/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        // Express accepts async handlers; their rejections are caught explicitly with .catch(next).
        { checksVoidReturn: { arguments: false } },
      ],
    },
  },

  // Browser: React client.
  {
    files: ["client/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    ...reactHooks.configs.flat.recommended,
  },
  // Existing client findings are owned by the frontend; reported as warnings until they are fixed,
  // then these can return to "error". New code should not add to them.
  {
    files: ["client/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  }
);
