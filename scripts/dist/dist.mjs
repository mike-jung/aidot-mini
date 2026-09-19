#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { ensureBuildDependencies } from '../prepare-dependencies.mjs';
import { findPython } from '../run-python.mjs';
import { findMakensis } from './build-tools.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const lock = readJson(path.join(ROOT, 'scripts/dist/runtime-lock.json'));
export const policy = readJson(path.join(ROOT, 'scripts/dist/runtime-files.json'));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${result.error?.message || result.stderr || result.stdout}`);
  }
  return result.stdout;
}
export function regularFile(root, relative) {
  if (!relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(p => !p || p === '.' || p === '..')) {
    throw new Error(`Unsafe release path: ${relative}`);
  }
  const filename = path.join(root, relative);
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symlink in release input: ${relative}`);
  }
  if (!fs.statSync(filename).isFile()) throw new Error(`Missing regular release file: ${relative}`);
  return filename;
}
function copy(root, relative, destination, target = relative) {
  const source = regularFile(root, relative), file = path.join(destination, target);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(source, file);
  fs.chmodSync(file, 0o644);
}
export function listFiles(root, relative = '') {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Symlink in package: ${name}`);
    return entry.isDirectory() ? listFiles(root, name) : [name];
  });
}
function put(root, name, content, executable = false) {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, { mode: executable ? 0o755 : 0o644 });
}
export function verifyBinary(bytes, platform, arch) {
  if (platform === 'win') {
    if (bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('Runtime is not a Windows executable');
    const offset = bytes.readUInt32LE(0x3c);
    if (offset > bytes.length - 24 || bytes.toString('ascii', offset, offset + 4) !== 'PE\0\0' || bytes.readUInt16LE(offset + 4) !== 0x8664) {
      throw new Error('Runtime PE architecture mismatch');
    }
  } else if (bytes.toString('hex', 0, 6) !== '7f454c460201' || bytes.readUInt16LE(18) !== ({ x64: 62, arm64: 183 })[arch]) {
    throw new Error('Runtime ELF architecture mismatch');
  }
}
function releasePackage(source) {
  const result = { ...source, private: true, aidotEdition: 'public', aidotDistribution: 'installed-runtime' };
  result.scripts = { start: 'node deploy/installed/launch.mjs start', configure: 'node deploy/installed/launch.mjs configure', status: 'node deploy/installed/launch.mjs status', stop: 'node deploy/installed/launch.mjs stop' };
  delete result.repository;
  return result;
}
function writeLaunchers(destination, platform) {
  if (platform === 'win') {
    const lines = ['@echo off', 'setlocal', '"%~dp0runtime\\node.exe" "%~dp0app\\deploy\\installed\\launch.mjs" %*', 'exit /b %errorlevel%', ''];
    put(destination, 'aidot-mini.cmd', lines.join('\r\n'));
    for (const action of ['start', 'configure', 'stop', 'status']) {
      put(destination, `${action}.cmd`, ['@echo off', `call "%~dp0aidot-mini.cmd" ${action} %*`, 'exit /b %errorlevel%', ''].join('\r\n'));
    }
  } else {
    put(destination, 'bin/aidot-mini', '#!/bin/sh\nset -eu\numask 077\nrelease_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)\nexec "$release_dir/runtime/node" "$release_dir/app/deploy/installed/launch.mjs" "$@"\n', true);
  }
}
function copyRobotSources(destination, version) {
  for (const family of ['ros1', 'ros2']) {
    const packageName = family === 'ros1' ? 'aidot_mini_ros' : 'aidot_mini_ros2';
    const prefix = `deploy/${family}/${packageName}/`, kit = `ros-src/${family}/src/${packageName}`;
    for (const file of policy.robot.filter(name => name.startsWith(prefix))) copy(ROOT, file, destination, `${kit}/${file.slice(prefix.length)}`);
    const common = 'deploy/ros/common/';
    for (const file of policy.robot.filter(name => name.startsWith(common))) copy(ROOT, file, destination, `${kit}/${file.slice(common.length)}`);
    const xml = path.join(destination, kit, 'package.xml');
    fs.writeFileSync(xml, fs.readFileSync(xml, 'utf8').replace(/<version>[^<]+<\/version>/, `<version>${version}</version>`));
    if (family === 'ros1') fs.chmodSync(path.join(destination, kit, 'scripts/aidot_robot_bridge'), 0o755);
  }
  put(destination, 'ros-src/README.md', '# Optional ROS source bridges\n\nThese are source workspaces, not compiled ROS SDKs. The Node API/robot client is already executable in the parent runtime.\n\nROS 1: source the installed ROS environment, enter ros1/, then run `catkin_make install`, source `install/setup.bash`, and run `roslaunch aidot_mini_ros robot.launch`.\n\nROS 2: source the installed ROS environment, enter ros2/, then run `colcon build --merge-install`, source `install/setup.bash`, and run `ros2 launch aidot_mini_ros2 robot.launch.py`.\n\nRequires the matching ROS SDK, navigation messages and robot drivers. See the project ROS guide for topics and action configuration. No legacy /opt systemd files are installed automatically.\n');
}
function README(version, platform, variant, runtime) {
  const launcher = platform === 'win' ? '.\\aidot-mini.cmd' : './bin/aidot-mini';
  return `# aidot-mini ${version} — ${platform} ${variant}\n\n` +
    'Self-contained public runtime for robot, drone, mobile/edge deployments. Node and the portable compiler are bundled; no Node/npm/Python installation is needed to run this package. The host implements the shared aidot-express controller/service/sql contract. Database configuration is local SQLite, not a MariaDB connection; use the same business files with the matching host dialect/migrations.\n\n' +
    '## First run\n\n```text\n' + `${launcher} configure --port 8901 --database app.db --profile note\n${launcher} start\n` + '```\n\n' +
    `Use \`${launcher} configure --profile product --database product.db\` before starting the Product example. Data, editable workspaces, DB, logs, uploads, certificates and compiled caches live together under LOCALAPPDATA/aidot-mini on Windows or XDG_DATA_HOME/aidot-mini on Linux. The install folder remains read-only at runtime. Consult the installed launcher's \`help\` output for exact supported options and state location.\n\n` +
    `\`${launcher} stop\` stops this installation's supervised process. \`${launcher} uninstall --purge\` removes its managed data only after ownership validation; \`uninstall\` without purge preserves data. Stop first before removing portable application files. Windows Setup provides matching keep-data / clear-data choices.\n\n` +
    (variant === 'full' ? 'This Full **runtime** includes the built-in management console at http://127.0.0.1:8901/. It does not include private Full-source publishing tools, Enterprise add-ons, Vue development dependencies or npm.\n\n' : 'A fresh Minimal installation is API-only: no static management console or Vue application is bundled. Both Note and Product controller/service/sql examples are included. Existing user state is preserved when changing variants, so a previously installed Full console may remain in that state.\n\n') +
    (variant === 'robot' ? 'Robot adds the Node robot client and complete ROS1/ROS2 source bridge workspaces under ros-src/. Start the Node robot client with `./bin/aidot-mini start --robot`. ROS, navigation stacks, hardware drivers and firmware are not bundled. Build the source bridges in a matching ROS environment.\n\n' : '') +
    `Bundled Node: ${lock.nodeVersion}. Provenance: ${runtime.provenance}. See distribution.json and manifest.json for target and hashes; runtime/LICENSE contains Node and its third-party notices.\n`;
}
export async function build(options) {
  const { target, arch, variant } = options;
  const platform = target === 'robot' ? 'linux' : target;
  if (!['win', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch) || (platform === 'win' && arch !== 'x64')) throw new Error('Supported targets: win-x64, linux-x64, linux-arm64, robot-arm64');
  if (!['minimal', 'full', 'robot'].includes(variant) || (variant === 'robot' && target !== 'robot')) throw new Error('Invalid runtime variant');
  const rootPackage = readJson(path.join(ROOT, 'package.json'));
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(rootPackage.version)) throw new Error('Unsafe package version');
  if (JSON.stringify(rootPackage.dependencies) !== JSON.stringify({ 'esbuild-wasm': '0.28.2' }) || rootPackage.optionalDependencies) throw new Error('Unreviewed runtime dependencies');
  const compiler = ensureBuildDependencies({ root: ROOT, offline: options.offline });
  const python = findPython();
  const makensis = platform === 'win' && !options.noInstaller ? findMakensis({ explicit: options.makensis }) : null;
  const output = path.resolve(options.output), cache = path.resolve(options.cache);
  fs.mkdirSync(output, { recursive: true }); fs.mkdirSync(cache, { recursive: true });
  const runtime = lock.archives[`${platform}-${arch}`], archive = path.join(cache, runtime.file);
  if (!fs.existsSync(archive)) {
    if (options.offline) throw new Error(`Missing pinned runtime: ${archive}`);
    const packageName = runtime.package.split('@')[0];
    const response = await fetch(`https://registry.npmjs.org/${packageName}/-/${runtime.file}`, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error(`Runtime download failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 200000000 || sha256(bytes) !== runtime.sha256) throw new Error('Downloaded runtime archive checksum mismatch');
    fs.writeFileSync(archive + '.download', bytes, { flag: 'wx' });
    fs.renameSync(archive + '.download', archive);
  }
  if (fs.lstatSync(archive).isSymbolicLink() || sha256(fs.readFileSync(archive)) !== runtime.sha256) throw new Error(`Runtime archive checksum mismatch: ${archive}`);
  const name = `aidot-mini-${rootPackage.version}-${target}-${arch}-${variant}`;
  const stageParent = fs.mkdtempSync(path.join(output, '.build-'));
  const destination = path.join(stageParent, name), app = path.join(destination, 'app');
  fs.mkdirSync(app, { recursive: true });
  try {
    const paths = new Set([...policy.common, ...(variant === 'full' ? policy.full : []), ...(target === 'robot' ? policy.robot.filter(file => file.startsWith('modules/')) : [])]);
    for (const relative of paths) copy(ROOT, relative, app);
    if (target === 'robot') copyRobotSources(destination, rootPackage.version);
    for (const relative of policy.compiler) copy(compiler, relative, path.join(app, 'node_modules/esbuild-wasm'));
    writeJson(path.join(app, 'package.json'), releasePackage(rootPackage));
    fs.mkdirSync(path.join(destination, 'runtime'));
    const binary = path.join(destination, 'runtime', platform === 'win' ? 'node.exe' : 'node');
    run(python, [path.join(ROOT, 'scripts/dist/archive.py'), 'runtime', archive, binary, `package/bin/${platform === 'win' ? 'node.exe' : 'node'}`]);
    const bytes = fs.readFileSync(binary);
    if (sha256(bytes) !== runtime.binarySha256) throw new Error('Runtime binary checksum mismatch');
    verifyBinary(bytes, platform, arch); fs.chmodSync(binary, 0o755);
    copy(ROOT, `scripts/dist/licenses/node-${lock.nodeVersion}-LICENSE`, destination, 'runtime/LICENSE');
    for (const filename of ['LICENSE', 'NOTICE', 'COPYRIGHT.md']) copy(ROOT, filename, destination);
    writeLaunchers(destination, platform);
    put(destination, 'README.md', README(rootPackage.version, platform, variant, runtime));
    const distribution = { format: 'aidot-mini-runtime/v1', version: rootPackage.version, edition: 'public', variant, target, platform, arch, nodeVersion: lock.nodeVersion, runtime: { package: runtime.package, archiveSha256: runtime.sha256, binarySha256: runtime.binarySha256, provenance: runtime.provenance, officialArtifact: runtime.officialArtifact }, requires: platform === 'linux' ? { glibc: '>=2.28', libstdcxx: true } : { os: 'Windows 10 1809 or later / Windows 11, x64' } };
    writeJson(path.join(destination, 'distribution.json'), distribution);
    const hashes = Object.fromEntries(listFiles(destination).map(file => [file, sha256(fs.readFileSync(path.join(destination, file)))]));
    writeJson(path.join(destination, 'manifest.json'), { ...distribution, files: hashes });
    const artifact = path.join(output, `${name}.${platform === 'win' ? 'zip' : 'tar.gz'}`);
    const temporary = artifact + '.tmp';
    run(python, [path.join(ROOT, 'scripts/dist/archive.py'), platform === 'win' ? 'zip' : 'tar', destination, temporary]);
    fs.renameSync(temporary, artifact);
    const outputs = [artifact];
    if (platform === 'win' && !options.noInstaller) {
      const include = path.join(stageParent, 'uninstall-files.nsh');
      run(python, [path.join(ROOT, 'deploy/windows/create-uninstall-manifest.py'), destination, include]);
      const installer = path.join(output, `${name}-setup.exe`);
      const define = process.platform === 'win32' ? '/D' : '-D';
      run(makensis, [`${define}PAYLOAD=${destination}`, `${define}VERSION=${rootPackage.version}`, `${define}OUTFILE=${installer}`, `${define}EDITION=${variant}`, `${define}UNINSTALL_MANIFEST=${include}`, path.join(ROOT, 'deploy/windows/installer.nsi')], { timeout: 300000 });
      outputs.push(installer);
    }
    const result = outputs.map(file => ({ file: path.basename(file), bytes: fs.statSync(file).size, sha256: sha256(fs.readFileSync(file)), version: rootPackage.version, edition: 'public', target, arch, variant }));
    for (const item of result) writeJson(path.join(output, `${item.file}.release.json`), { format: 'aidot-mini-release-artifact/v1', ...item });
    if (options.keepStage) {
      const stage = path.join(output, `${name}.payload`);
      if (fs.existsSync(stage)) throw new Error(`Refusing to overwrite existing payload: ${stage}`);
      fs.renameSync(destination, stage);
    }
    return result;
  } finally { fs.rmSync(stageParent, { recursive: true, force: true }); }
}

async function main() {
  const { values } = parseArgs({ options: {
    target: { type: 'string', default: 'linux' }, arch: { type: 'string' }, variant: { type: 'string', default: 'minimal' },
    output: { type: 'string', default: path.join(ROOT, 'dist/release') }, cache: { type: 'string', default: path.join(ROOT, 'runtime-cache/dist') },
    offline: { type: 'boolean', default: false }, 'no-installer': { type: 'boolean', default: false }, 'keep-stage': { type: 'boolean', default: false }, makensis: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) { console.log('dist.mjs --target win|linux|robot --arch x64|arm64|all --variant minimal|full --output DIR [--offline] [--no-installer] [--keep-stage]'); return; }
  const arch = values.arch || (values.target === 'robot' ? 'arm64' : 'x64');
  const arches = arch === 'all' && values.target === 'linux' ? ['x64', 'arm64'] : [arch];
  const results = [];
  for (const architecture of arches) results.push(...await build({ ...values, arch: architecture, variant: values.target === 'robot' ? 'robot' : values.variant, noInstaller: values['no-installer'], keepStage: values['keep-stage'] }));
  console.log(JSON.stringify(results, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
