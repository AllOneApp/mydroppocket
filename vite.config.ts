// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    // Force tslib to its ESM build so named helper imports like `__extends`
    // resolve correctly under the Cloudflare Worker SSR ESM bundler.
    // Without this, pdf-lib (which uses `import { __extends } from "tslib"`)
    // fails at runtime with:
    //   TypeError: Cannot destructure property '__extends' of '__toESM(...).default'
    resolve: {
      alias: {
        tslib: "tslib/tslib.es6.js",
      },
    },
  },
});
