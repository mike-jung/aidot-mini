# aidot-mini 0.6.2

A small annotation-based JavaScript web server for mobile devices, robots and drones.
Node >=22.13; SQLite included in Node; one runtime npm dependency: esbuild-wasm.

```sh
npm ci --ignore-scripts
npm start
```

Open http://127.0.0.1:8901 and create an administrator ID/password. English is
the default. The default Note example supports list, add, edit and delete.

- [Console source editor and log viewer](docs/CONSOLE_V060_EN.md)
- [콘솔 파일 편집·로그 조회](docs/CONSOLE_FILES_LOGS_KO.md)
- [Self-contained AI API rules](docs/AI_API_RULES.md)
- [Linux build and deployment](docs/DEPLOY_LINUX.md)
- [ROS build and deployment](docs/DEPLOY_ROS.md)
- [Licensing](docs/LICENSING.md), [copyright](COPYRIGHT.md), [security](SECURITY.md)

```sh
npm run https:cert -- --hosts localhost,127.0.0.1,::1 --apply
npm run verify
npm run build:linux -- --arch x64 --download --deb
npm run build:ros -- --family all
```

Public contains the complete single-device development and operation path.
Production fleet/organization Enterprise extensions are not implemented in this
version. Optional robot and communication modules remain separate from the core.
Source editing takes effect after server restart. Saved preferences and environment
variables take precedence over defaults. See the linked operational guides for
build requirements and target-specific validation limits.

