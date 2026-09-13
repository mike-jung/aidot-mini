# Third-party notices

## aidot-express

This product includes code copied or adapted from aidot-express 1.45.1 by
Aidot Link Co., Ltd.: `src/core/decorators.js`, `src/core/container.js`,
`src/core/paramParser.js` and `src/database/sqlite-dialect.js`.

The decorator implementation is adapted for aidot-mini dependency metadata and
rejects class-level authentication declarations. The complete upstream Apache
License 2.0 and NOTICE are retained under `docs/third-party/` in source packages
and under `third-party/` or the licenses directory in device packages.

Source: https://github.com/mike-jung/aidot-express

## esbuild-wasm

`esbuild-wasm` 0.28.2 is licensed under the MIT license. Its complete `LICENSE.md`
is included by npm and retained in runtime packages. The device bundle includes
the package metadata, browser compiler, WebAssembly binary and license.

Source: https://github.com/evanw/esbuild

## Node.js and device runtimes

Linux runtime versions and archive checksums are pinned in
`deploy/linux/runtime-lock.json`. Linux packages retain `runtime/LICENSE`,
including notices for Node.js and its bundled components.

Android runtime versions and hashes are pinned in `android/runtime-packages.json`
and `android/runtime-manifest.json`. Notices are retained in
`android/runtime-licenses/` and APK license assets.

## Optional communication adapters

The separately installed communication package uses MQTT.js and Socket.IO under
their MIT licenses. Exact versions are in `addons/communications/package-lock.json`.
Retain the license files supplied with these packages and their dependencies
when including the adapters in a distribution.
