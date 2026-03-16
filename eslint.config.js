import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        URL: "readonly",
        Set: "readonly",
        Map: "readonly",
        Promise: "readonly",
        Buffer: "readonly",
        MutationObserver: "readonly",
        PerformanceObserver: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        document: "readonly",
        window: "readonly",
      },
    },
    ignores: ["generated/**"],
  },
  {
    ignores: ["generated/**", "node_modules/**"],
  },
];
