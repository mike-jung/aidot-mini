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

## Vue client

The optional client uses Vue 3, Pinia, Axios, Vite and @vitejs/plugin-vue.
These packages use MIT licenses; pinned versions and transitive dependencies
are recorded in examples/product-client/package-lock.json. npm installs each
package with its license. Retain licenses when distributing bundled dependencies.

The source starter does not include Node binaries or device SDKs.

## Supplied WT client assets

The optional `examples/product-client/public/assets/` tree is retained from the user-supplied WT project. Its Metronic theme, embedded vendor files, images and fonts retain their original terms and notices; they are not relicensed under the server runtime license. npm dependencies are separately listed in the client package and lockfile.
