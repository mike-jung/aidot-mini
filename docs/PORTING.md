# Portable aidot-express workspace profile

## File contract

The current default is Note CRUD. Both public and Auth Note variants come from
unmodified aidot-express 1.45.2 console generator functions. Copy controller/,
service/ and sql/ including both meta/ directories. Keep annotations, imports,
method signatures and return shapes. No Express runtime dependency is added to mini.

The companion metadata supports the Express editor and regeneration. Mini uses
annotations to execute the API. Since 0.5.1 it generates missing sidecars and loads
metadata at startup, synchronizing declarations while preserving descriptions and
extension fields. Unchanged files are not rewritten. `npm run contract:check` also
prepares metadata before checking declarations. Do not hand-author the sidecars.
Use `npm run workspace:compile` before installing code read-only.
The Express console preview/save round trip provides stronger evidence for the
built-in Note example; the checker alone does not prove arbitrary custom code round trips.

## Paths

Mini supports an absolute APP_WORKSPACE or a workspace saved through Console >
Settings. Restart to apply it. Generated relative imports such as
`../../src/core/decorators.js` resolve to the active mini host even from an external
Unicode directory. The reference Express generator computes imports based on its
workspace placement.

The executed reverse-port target was a workspace directly below the Express
project root. In that layout, generated `../../src/...` imports resolve unchanged.
An arbitrary external Express workspace must also provide correct host import
resolution. This report does not claim that every relative import remains valid
at every filesystem depth. Do not rewrite business APIs to hide a host path issue.

## Database

Mini uses one node:sqlite connection and a SQLite file. Note uses a plain `note`
table and bound named parameters. The Note round trip tested Express's own
better-sqlite3 driver. Provision the same table, columns and timestamp policy on
the target host. Express does not automatically run mini workspace migrations.

The default 002 migration creates and seeds the Note table on mini. Its limited
MariaDB-shaped AUTO_INCREMENT DDL is normalized by mini's SQLite dialect adapter.
For Express SQLite, use `docs/note-sqlite.sql` or equivalent DDL. On MariaDB, use
`docs/note-mariadb.sql` and verify date serialization and constraints on that target.
These DDL files are deployment setup; `sql/note.sql` stays unchanged.

DB_APP_SCHEMA=aidot_app maps qualified `aidot_app.table` references to SQLite's
main database only during execution. Plain `note` queries need no schema mapping.
String literals, comments and column aliases are preserved. Other schemas are not
silently merged. No universal MariaDB syntax, collation, stored procedure or
multi-schema compatibility is claimed.

## API behavior

- Legacy @Controller / @Service / @Autowired / @Sql / @Log remain the model.
- Handlers use `(params)` or `(params, req, res)`; query < body < path precedence.
- List returns rows; getById returns the first row or null; Controller handles 404.
- Create returns `{ insertId, rowsAffected }`; explicit HTTP response is 201.
- Update calls `fillPlaceholders(sql, params)`; omitted fields become null.
- Update and remove return `{ rowsAffected }`, including zero for a missing row.
- Host envelopes use `code/message/header/data`; requestCode propagates to header.

Generated Note has no business validation. Define validation and error status for
new production APIs. Browser input constraints do not validate direct API calls.

## Auth and infrastructure

Public and Auth Note variants expose the same CRUD operations. Auth adds guards
and corresponding metadata. Each host issues its own session/token. Credentials
are not portable business files. The mini console supports local ID/password.
HTTPS, accounts, DB paths and deployment state are configured per host.

Express's full SSE hub, admin generators, MCI and every optional decorator are not
included in the mini portable profile. MQTT, Socket.IO, ROS and VPN integrations
belong to adapters outside portable business files unless a feature is explicitly
supported and tested on both hosts. See the full project's deployment guides.

## Executable evidence

`node scripts/verify-note-express.mjs /path/to/aidot-express` in the full project
starts real isolated servers, exercises 15 cases for each variant, compares
responses, reads metadata through the actual Express console API, regenerates and
saves code there, then runs the returned files on mini. All five source/meta files
are hashed. Only response header timestamps and development stacks are excluded
from response comparison; business date fields are included.

See NOTE_COMPATIBILITY_KO.md and VALIDATION_NOTE_ROUNDTRIP.md for the tested version
and targets. For each new API, repeat equivalent tests on its target database.
