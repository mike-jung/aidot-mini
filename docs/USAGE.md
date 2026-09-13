# Configuration and console usage

## Start and sign in

Run `npm ci --ignore-scripts`, then `npm start` from the source project.
Open `http://127.0.0.1:8901`. A fresh loopback installation offers one-time
administrator ID/password setup. There is no shared default password.
Use **Remember me** to retain the login on that browser.

To create or recover an account from the terminal, stop the server and run
`npm run admin:account` using the same `DATA_DIR` and OS account as the service.
Start it again afterwards. Console authentication is separate from the public
Note API. The authenticated example is in `examples/note-auth-workspace`.

## Settings and workspace

The Settings tab controls the workspace, console language and server preferences.
English and Korean are supported. A saved setting may be overridden by `.env`;
process environment variables take precedence over both. Restart after changing
network or workspace settings. Paths refer to the server computer.

```dotenv
APP_WORKSPACE=/absolute/path/to/workspace
DATA_DIR=/absolute/path/to/data
CONSOLE_LANGUAGE=en
HOST=127.0.0.1
PORT=8901
```

Use `npm run workspace:init -- ./my-workspace` for a new Note workspace or add
`--empty` for an empty one. The command refuses to overwrite a nonempty target.
Startup loads its migrations, named SQL, Services and Controllers. Missing
`controller/meta` and `service/meta` files are generated automatically. Existing
metadata descriptions and extension information are retained when declarations
synchronize. Run `npm run workspace:compile` before a read-only installation.

## Edit code and view logs

In **Workspace files**, select an existing Controller, Service or SQL file and
use **Validate and save**. JavaScript annotations are compiled for syntax checking.
SQL checks cover query names and empty/duplicate declarations; run API tests to
verify actual SQL execution and business results.

Normal execution needs a restart after an edit; `npm run dev` watches changes.
Metadata and migrations are read-only in the editor. Files must be UTF-8 and at
most 64 KiB. If another editor changes a file, saving returns a conflict and
preserves your buffer so you can reload and merge.

In **Log files**, choose a log, level and literal search string. The viewer reads
the latest 128 KiB and displays up to 300 matching lines. Optional refresh runs
every five seconds while the tab is visible. A search covers only this tail.
`LOG_TO_FILE=false` disables new file logging; older log files can still be viewed.

Code editing is an administrator capability to change server behavior. Use a
separate writable workspace when application code is installed read-only.

## HTTPS and LAN access

OpenSSL 1.1.1 or later is required to generate a certificate. It is not needed
to run HTTPS after the certificate has been created.

```sh
npm run https:cert -- --hosts localhost,127.0.0.1,::1 --apply
npm start
```

This writes `certs/server.crt` and `certs/server.key` and updates TLS settings
in `.env`, preserving other settings and backing up the previous file. Restart
the server and open `https://localhost:8901`. The certificate is self-signed and
is not automatically trusted by browsers. Configure a trusted CA-issued
certificate for deployment.

To expose a server on your network, include its real name/IP in the certificate,
then configure the listener and allowed hosts:

```dotenv
HOST=0.0.0.0
PORT=8901
HTTPS_ENABLED=true
TLS_CERT_FILE=./certs/server.crt
TLS_KEY_FILE=./certs/server.key
ALLOWED_HOSTS=192.168.10.20,robot.example.internal
```

`--hosts` configures certificate names, not the listener. Use the actual server
address instead of the examples. LAN bindings require HTTPS. For IPv6 loopback,
bind `HOST=::1` and use `https://[::1]:8901`.

A matching valid certificate is reused. Renew or change its names with
`npm run https:cert -- --hosts <names> --apply --force`; existing files are backed
up. `npm run https:cert -- --help` lists all options. On Windows, `OPENSSL_BIN`
can select an OpenSSL executable if automatic discovery fails.

## Status events and backups

The administrator console uses Server-Sent Events for status updates. The stream
keeps a short reconnect history in memory. Refresh state after a reset event;
it is not a durable queue for robot orders or business transactions.

Keep account data, settings, database and logs outside deployed source.
Stop the service before making a simple file backup of SQLite and associated
state. Back up before applying migrations; restoring only an old executable
does not roll back a changed database schema.
