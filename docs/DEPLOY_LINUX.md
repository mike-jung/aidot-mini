# Linux servers and robot boards

Run the source project on a supported Node.js installation, or build a package
that includes its own Node runtime. ROS is optional for a normal web server.
The packaged runtime supports Linux x64 and ARM64 with glibc; Android, musl/Alpine
and ARMv7 require different runtime builds.

## Build a runtime package

Use a Linux build host with Python 3, npm and GNU `readelf`. Debian output also
needs `dpkg-deb`. Runtime archives and SHA-256 checksums are pinned in
`deploy/linux/runtime-lock.json`. A cache entry with a different hash is rejected.

```sh
npm ci --ignore-scripts
npm run build:linux -- --arch x64 --download --deb
npm run build:linux -- --arch arm64 --download --deb
```

Set `APP_WORKSPACE` to an absolute path before building to include another
workspace. The builder prepares annotation caches and metadata. Use
`--runtime-cache /path/to/cache` to select an existing runtime cache.
Files are written to `dist/linux/`. The package manifest records the runtime,
architecture, ABI requirements and file hashes. Building for ARM64 on x64 does
not execute the package on ARM64.

## Run the archive

```sh
tar -xzf aidot-mini-1.0.1-linux-x64.tar.gz
cd aidot-mini-1.0.1-linux-x64
./bin/aidot-mini --check
./bin/aidot-mini
```

Open `http://127.0.0.1:8901`. The launcher uses the bundled runtime; npm is not
required on the target. Its `--check` verifies file integrity, architecture,
SQLite read/write behavior and random-number support on the current host.
Data defaults to the user's XDG state directory. Set `DATA_DIR` explicitly for
a service installation. The binary requires glibc 2.28+ and GLIBCXX 3.4.21+;
check the actual release manifest and target ABI before deployment.

## Debian and systemd

```sh
sudo dpkg -i aidot-mini_1.0.1_amd64.deb
sudo cp /opt/aidot-mini/deploy/aidot-mini.env.example /etc/aidot-mini/aidot-mini.env
sudo chmod 600 /etc/aidot-mini/aidot-mini.env
```

Installation creates a dedicated account and directories but does not start
the service. Edit `/etc/aidot-mini/aidot-mini.env` for your network, TLS and data
paths. For a LAN listener, configure HTTPS with a certificate trusted by clients.
Create the administrator account with the service account and its data directory:

```sh
sudo -u aidot-mini env DATA_DIR=/var/lib/aidot-mini /opt/aidot-mini/bin/aidot-mini --admin-account
sudo systemctl enable --now aidot-mini.service
sudo systemctl status aidot-mini.service
```

On an existing installation, stop the service before changing the account.
Program files can remain read-only; place an editable workspace in a separate
writable directory. The service account needs read access to its TLS key.
See [console and HTTPS configuration](USAGE.md).

## Robot boards and updates

For robot integration, install the appropriate [ROS bridge](DEPLOY_ROS.md) and
configure the robot's navigation action, pose, battery and map frame. General
web-server operation does not require ROS.

Before upgrading, stop active robot orders, stop the services and back up the
DB, settings and robot journals. After installation, run `--check`, verify
readiness and exercise your actual API and robot integration. Database schema
changes require a corresponding restore plan. Test power loss, storage behavior,
thermal limits and long-running operation on the target board.
