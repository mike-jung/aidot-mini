# Source provenance and third-party notices

## aidot-express 1.45.1

The compatibility contract was compared against the user-supplied aidot-express-1.45.1-full.zip, SHA-256:

8fd07b50e8b6c5bdf4f0a24aa24c226ba7014bfa1e5285517f0f3a1259104929

The following files were copied or adapted from that source:
- src/core/decorators.js (adapted: dependency preflight metadata and explicit class-Auth rejection)
- src/core/container.js
- src/core/paramParser.js
- src/database/sqlite-dialect.js

The upstream archive supplies the Apache License 2.0. Its complete text is retained in third-party/aidot-express-LICENSE. Modified runtime behavior is described in COMPATIBILITY_V050_KO.md. The verification harness reads Book/Student fixtures from the supplied target and does not bundle that entire server.

The visual tutorial template follows the user-supplied aidot-express tutorial family and retains its native colors, typography and layout.

## esbuild-wasm 0.28.2

Source and documentation: https://github.com/evanw/esbuild , https://esbuild.github.io/api/ .

MIT license; the complete upstream LICENSE.md is included with node_modules/esbuild-wasm in source/runtime packages. Package lock and the runtime asset allowlist fix the version. Only package.json, LICENSE.md, lib/browser.js and esbuild.wasm are needed in the device runtime bundle.

## Node.js

Linux runtime archives and checksums are pinned in deploy/linux/runtime-lock.json. The release includes runtime/LICENSE from the selected distribution, including Node and bundled components' notices.

## Development-only tools

Browser verification used Playwright and Microsoft Edge. The inherited tutorial family uses the supplied style; version 0.5.1 was edited with artifact-tool. These tools are not added as server runtime dependencies.

## 0.6.0 changes

The console editor/log viewer and font-independent m. SVG are new Aidot code. Existing upstream attribution is retained. The publication structure was compared with aidot-express 1.45.2; its private implementation is not bundled as an additional server. No new runtime dependency was added.
