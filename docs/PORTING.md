# Porting a workspace

aidot-mini supports the annotated Controller/Service/SQL profile used by the
aidot-express workspace generator. Keep these source files unchanged when moving
an API between supported hosts. Both Note variants use the same file contract.

## Files and metadata

Copy `controller/`, `service/` and `sql/`, including generated `meta/` folders.
Keep default class exports, annotations, imports, method signatures, query names
and response shapes. Run the source on aidot-mini to generate missing metadata
before exporting; do not write sidecars manually.

`module.json` identifies the files for `npm run port:export`. Configure the target
host's workspace loader to read the destination folder, then restart it.
For the standard `../../src/...` imports on aidot-express, placing the workspace
directly below the host project root preserves relative paths. An external
workspace also needs the target host's import-resolution support.

## Database setup

aidot-mini applies workspace migrations to built-in SQLite. Provision the same
table, columns and timestamp behavior on the receiving host; do not assume it
automatically applies aidot-mini migrations.

- [SQLite Note table](note-sqlite.sql)
- [MariaDB Note table](note-mariadb.sql)
- [Note table description](note-table.json)

These setup files are separate from the portable queries in `sql/note.sql`.
MariaDB syntax, collation, stored procedures and multiple database schemas do not
become universally compatible through file copying. `DB_APP_SCHEMA` maps one
configured application schema to SQLite's main database during execution;
plain `note` queries do not need this mapping.

## API contract

| Operation | Contract |
|---|---|
| Controller arguments | `(params, req, res)`; query < JSON body < URL path |
| List | Array of rows inside `data` |
| Read | One row; Note sends 404 for a missing ID |
| Create | HTTP 201 with `{ insertId, rowsAffected }` inside `data` |
| Update/delete | `{ rowsAffected }`, including zero for a missing row |
| Envelope | `code`, `message`, `header`, `data` |

`fillPlaceholders(sql, params)` binds omitted fields as null. It does not validate
a payload or implement partial updates. Define business validation explicitly
for each API and compare date serialization on the target database.

## Authentication and verification

Apply `@Auth()` to each protected method. Configure credentials and HTTPS on
each host separately; account files and sessions are not portable business code.

Run `npm run check`, `npm run contract:check` and real HTTP tests on aidot-mini.
Run the same requests on the destination and compare status, payload, missing-row
behavior, authentication and persistence. Note tests do not verify an unrelated
API or every optional feature of another framework.

Keep MQTT, Socket.IO, ROS and VPN integrations in adapters unless both hosts
explicitly support the business-level interface. See the [API guide](AI_API_RULES.md).
