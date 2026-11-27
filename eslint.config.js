import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import vue from "eslint-plugin-vue";
import vueParser from "vue-eslint-parser";
import importPlugin from "eslint-plugin-import";
import prettier from "@vue/eslint-config-prettier";

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "public/**",
      "src/**/__generated__/**",
      "components.d.ts",
      "src/auto-imports.d.ts",
      ".eslintrc-auto-import.json",
      // Ad-hoc Playwright probe scripts whose bodies run inside
      // page.evaluate(); they use browser globals in .mjs files and are
      // not part of the app or the e2e suites.
      "tests/e2e/scripts/**",
    ],
  },
  js.configs.recommended,
  ...vue.configs["flat/recommended"],
  {
    files: ["**/*.{ts,tsx,vue}"],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tsparser,
        ecmaVersion: "latest",
        sourceType: "module",
        extraFileExtensions: [".vue"],
        // A handful of legacy components use `<script lang="jsx">` (e.g.
        // src/components/objects/MeetingObject/Track.vue) for inline render
        // functions. Without `ecmaFeatures.jsx`, the TS parser bails on the
        // first JSX `<` and reports `Parsing error: '>' expected.`, which
        // also masks every other rule on that file.
        ecmaFeatures: { jsx: true },
      },
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        fetch: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        FormData: "readonly",
        Blob: "readonly",
        File: "readonly",
        FileReader: "readonly",
        WebSocket: "readonly",
        process: "readonly",
        global: "readonly",
        Buffer: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      import: importPlugin,
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-undef": "off",
      "vue/multi-word-component-names": "off",
      // Every remaining v-html site must go through utils/sanitizeHtml.ts;
      // keep the rule visible so new sites are reviewed.
      "vue/no-v-html": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "vue/no-mutating-props": "warn",
      "vue/require-default-prop": "off",
      "vue/component-name-in-template-casing": ["warn", "PascalCase"],
      // `vue/component-tags-order` was renamed to `vue/block-order` in
      // eslint-plugin-vue v9. Keeping the same `script, template, style`
      // ordering preference.
      "vue/block-order": ["warn", { order: ["script", "template", "style"] }],
    },
  },
  {
    files: ["**/*.{js,cjs,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        process: "readonly",
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
  },
  prettier,
];
