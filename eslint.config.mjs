import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated service worker files from next-pwa:
    "public/sw.js",
    "public/workbox-*.js",
    // Vendored pdf.js worker copied from node_modules by the postinstall
    // script — minified third-party code, not ours to lint.
    "public/pdf.worker.min.mjs",
    // Plain-Node build utilities (CommonJS), not part of the app bundle.
    "scripts/**",
  ]),
]);

export default eslintConfig;
