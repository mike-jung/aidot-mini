<div align="center">

# aidot-mini

**Write your API once. Run it on the device or on aidot-express.**

A small Node.js API runtime for robots, drones, and mobile terminals.
Spring-style Controllers, Services, and SQL — with local SQLite and optional device integrations.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D22.19-brightgreen)
![Version](https://img.shields.io/badge/version-1.0.10-orange)

</div>

---

## Why aidot-mini?

Devices need APIs that keep working when the network is unavailable. Teams also
need to reuse business logic when an application moves between a device and a server.

**aidot-mini** brings the Controller–Service–SQL structure of aidot-express to a
small local runtime. It uses Node.js built-in HTTP and SQLite, with one direct npm
dependency: `esbuild-wasm`. Local APIs and storage run independently of the console
and device integrations.

## What you get

| Feature | What it does |
|---|---|
| **Spring-style APIs** | Define routes, services, dependency injection, SQL, and access rules with annotations such as `@Controller`, `@Service`, `@Autowired`, `@Sql`, and `@Auth`. |
| **Local storage** | Run APIs with embedded SQLite, named queries, parameter binding, and schema migrations, including offline operation. |
| **Shared business code** | Move Controller, Service, and SQL files between mini and aidot-express using the shared API contract. |
| **Browser console** | Manage settings, edit workspace files, and inspect logs and runtime status. Included in this source repository. |
| **Device integrations** | Add robot SDK/ROS bridges or optional MQTT and Socket.IO adapters as needed. |

## Quick start

Requires **Node.js 22.19.0 or later**.

```bash
git clone https://github.com/mike-jung/aidot-mini.git
cd aidot-mini
npm ci --ignore-scripts
npm start
```

Open **[http://127.0.0.1:8901](http://127.0.0.1:8901)** and create an administrator
ID and password on the first local start. There is no shared default password.
For terminal-based setup or recovery, stop the server and run `npm run admin:account`
with the same data directory and OS account.

Try **[GET /api/notes](http://127.0.0.1:8901/api/notes)**. The bundled Note demo has
public CRUD endpoints; an [authenticated example](examples/note-auth-workspace/README.md)
is also included.

### Your first endpoint

Create `workspace/controller/HelloController.js`:

```js
import { Controller, GetMapping } from '@aidot/core/decorators.js';

@Controller('/api/hello')
export default class HelloController {
  @GetMapping('/')
  async hello() {
    return { message: 'Hello from aidot-mini' };
  }
}
```

Restart the server, then call `GET http://127.0.0.1:8901/api/hello`.
During development, use `npm run dev` to restart automatically when workspace files change.

## Write and verify business APIs

Keep routes in `controller/`, business logic in `service/`, and named queries in
`sql/`. Put schema changes in new migration files; preserve migrations already applied.

For AI-assisted development, start with the [API authoring rules](docs/AI_API_RULES.md).
Create a separate workspace:

```bash
npm run workspace:init -- ./my-workspace --empty
```

Add your code, migrations, and HTTP test cases, then run:

```bash
npm run workspace:compile -- ./my-workspace
npm run workspace:verify -- --workspace ./my-workspace --cases ./my-cases.json
```

Use the [example cases](docs/AI_WORKSPACE_CASES.json) as a format reference.
The verifier uses a temporary source copy and a fresh SQLite database. Without
`--cases`, it checks startup and declarations only. Add `--migrations <directory>`
when migrations live outside the workspace.

To run the application, set `APP_WORKSPACE` in `.env` and restart.
The [Product example](docs/TUTORIAL_PRODUCT_KO.md) demonstrates public reads,
administrator-only writes, pagination, image uploads, and an optional Vue 3 client.

## Use the same code with aidot-express

Copy the `controller/`, `service/`, and `sql/` folders to the target workspace,
keeping shared imports such as `@aidot/core/...` and `@aidot/database/...`.

The compatibility baseline for this release is **aidot-express 1.45.8** and its
shared business API contract. Configure the target host's database schema,
settings, accounts, and uploaded files separately. Database-specific SQL and
external dependencies need validation on the target host.

See the [porting guide](docs/PORTING.md) for the scope and verification procedure.

## Build for devices

<!-- DEVICE_BUILDS_START -->
Run these commands from the repository root:

| Target | Command | Output |
|---|---|---|
| [AI Starter](docs/AI_STARTER.md) | `npm run build:starter` | API development source, examples, and verification tools; requires Node.js. |
| [Windows x64](docs/INSTALL_WINDOWS_KO.md) | `npm run dist:win` | Runtime ZIP and NSIS installer. |
| [Linux x64](docs/DEPLOY_LINUX.md) | `npm run dist:linux -- --arch x64` | Runtime package. |
| [Linux ARM64](docs/DEPLOY_LINUX.md) | `npm run dist:linux -- --arch arm64` | ARM64 runtime package. |
| [Robots / drones](docs/DEPLOY_ROS.md) | `npm run dist:robot` | Linux ARM64 runtime with robot integration files. |
| [Android](docs/DEPLOY_ANDROID.md) | `npm run dist:android` | APK build using an Android-compatible Node runtime. |

Device packages bundle Node.js. Use `npm run dist:win:full` or
`npm run dist:linux:full` to include the console UI; minimal packages and the
AI Starter omit it. Windows, Linux, and robot outputs go to `dist/release/`.

Build machines need Node.js and Python 3. Missing or incomplete npm build
dependencies are prepared automatically with `npm ci --ignore-scripts`.
Windows installers also require NSIS 3; its standard Windows installation path
is detected automatically. Android APK builds require JDK 17+ and Android SDK
platform 36; the build downloads the pinned Android runtime and uses the included
Gradle wrapper. See the linked guides for setup and signing requirements.

ROS and device SDKs are separate integrations. aidot-mini runs application APIs;
real-time motion and safety control remain with the device's control system.
<!-- DEVICE_BUILDS_END -->

## GitHub releases

After building the required targets, run:

```bash
npm run release:github
```

This creates a **Draft Release** in `mike-jung/aidot-mini`, uploading verified
public artifacts from `dist/release/` and their checksums. It requires an
authenticated GitHub CLI (`gh auth login`) and the version tag already pushed
to that repository (`v1.0.10` for this release). Existing releases are never overwritten.

```bash
npm run release:github -- --dry-run                  # Local plan only; no GitHub access
npm run release:github -- --repo owner/repository    # Use another repository
```

The earlier `--publish --repo mike-jung/aidot-mini` form remains supported.

## Configuration and operation

Use [.env.example](.env.example) to configure the port, workspace, database, and
logging. Source runs use `workspace/` and `data/` by default. Installed Windows
packages keep settings, databases, and other mutable state in
`%LOCALAPPDATA%\aidot-mini`.

The default listener is `127.0.0.1:8901`. LAN access requires HTTPS.
See [configuration and console usage](docs/USAGE.md) for certificates,
authentication, settings, and backups, and [communications adapters](addons/communications/README.md)
for MQTT and Socket.IO setup.

## Verification and contributing

```bash
npm run verify             # Static checks, regression tests, and Product HTTP tests
npm run product:contract   # Product API contract checks
```

See the [1.0.10 release record](docs/RELEASE_1.0.10_KO.md) for changes and verification.
The [1.0.8 platform report](docs/RELEASE_1.0.8_KO.md) records earlier device builds
and hardware coverage. Some detailed guides are currently in Korean.

Read [CONTRIBUTING](CONTRIBUTING.md) before submitting changes and
[SECURITY](SECURITY.md) to report a vulnerability.

## License

**Apache License 2.0** — see [LICENSE](LICENSE), [NOTICE](NOTICE), and
[third-party notices](docs/THIRD_PARTY_NOTICES.md).

© 2026 Aidot Link Co., Ltd. · mike.jung.global@gmail.com
