# aidot-mini 1.0.1

A lightweight, Spring Boot-style JavaScript web server for mobile devices,
robots and drones. Build APIs with annotated Controllers, Services and named
SQL, then run them on a desktop, Linux server or supported device.

## Features

- Automatic loading from a configurable workspace.
- Annotation-based dependency injection and HTTP routes.
- SQLite storage with migrations and bound SQL parameters.
- A small English/Korean console with administrator ID/password login.
- Note CRUD examples, with public and authenticated API variants.
- Workspace code editing, syntax validation and bounded log viewing.
- HTTPS configuration and a local certificate command.
- Server-Sent Events, optional MQTT/Socket.IO adapters and ROS navigation bridges.

The core uses Node.js built-in SQLite and one npm dependency, `esbuild-wasm`.
Optional communication adapters install their dependencies separately.

## Quick start

Install Node.js 22.13 or later, then run these commands in the project folder:

```sh
npm ci --ignore-scripts
npm start
```

Open **http://127.0.0.1:8901**. On a fresh local installation, create an
administrator ID and password. Use **Sample API** to list, create, edit and
delete notes. English is the default console language.

## Write an API

| Workspace folder | Purpose |
|---|---|
| `controller/` | HTTP routes and Service calls |
| `service/` | Business logic and database calls |
| `sql/` | Named queries with bound parameters |
| `migrations/` | Database schema changes |

The server generates and loads missing Controller/Service metadata. Business
files do not need manual route registration or metadata editing.

Select an external workspace in `.env` or Console > Settings:

```dotenv
APP_WORKSPACE=/absolute/path/to/my-workspace
DATA_DIR=/absolute/path/to/my-data
```

Restart the server after changing the workspace. During development,
`npm run dev` restarts it when source files change.

Give an AI assistant the project and the complete [API authoring guide](docs/AI_API_RULES.md).
Use the [porting guide](docs/PORTING.md) when moving business files to another host.

## HTTPS

With OpenSSL available, create a local development certificate and apply it:

```sh
npm run https:cert -- --hosts localhost,127.0.0.1,::1 --apply
npm start
```

Open **https://localhost:8901**. For deployment, configure a certificate trusted
by your clients and include the server's actual name or IP address.
See [configuration and console usage](docs/USAGE.md).

## Verify and build

```sh
npm run verify
npm run api:verify
npm run build:starter
```

The Starter is a small source project for creating APIs with an AI assistant.
It includes the runtime, console, Note examples and API guide.

<!-- DEVICE_BUILDS_START -->
Device packages are built from the Full or Public source project:

```sh
npm run build:linux -- --arch x64 --download --deb
npm run build:ros -- --family all
```

- [Linux servers and robot boards](docs/DEPLOY_LINUX.md)
- [ROS 1 and ROS 2 integration](docs/DEPLOY_ROS.md)
- [Android application builds](docs/DEPLOY_ANDROID.md)
- [Optional MQTT and Socket.IO adapters](addons/communications/README.md)

Each target needs its documented build tools and runtime dependencies.
<!-- DEVICE_BUILDS_END -->

## License

The Public project is licensed under [Apache License 2.0](LICENSE).
See [copyright and distribution terms](COPYRIGHT.md), [notices](NOTICE),
[third-party notices](docs/THIRD_PARTY_NOTICES.md) and [security guidance](SECURITY.md).

