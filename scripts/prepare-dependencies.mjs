import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expected = { 'esbuild-wasm': '0.28.2' };
const compilerFiles = ['package.json', 'LICENSE.md', 'lib/browser.js', 'esbuild.wasm'];
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function compilerReady(root) {
  const base = path.join(root, 'node_modules/esbuild-wasm');
  try {
    if (fs.lstatSync(base).isSymbolicLink()) throw new Error('Linked compiler directory is not supported');
    for (const name of compilerFiles) {
      const file = path.join(base, name), stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) return false;
    }
    return readJson(path.join(base, 'package.json')).version === expected['esbuild-wasm'] &&
      fs.readFileSync(path.join(base, 'esbuild.wasm')).subarray(0, 4).equals(Buffer.from([0, 97, 115, 109]));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return false;
    throw error;
  }
}

export function npmCommand({ env = process.env, executable = process.execPath } = {}) {
  const directory = path.dirname(executable);
  const candidates = [env.npm_execpath, path.join(directory, 'node_modules/npm/bin/npm-cli.js'),
    path.resolve(directory, '../lib/node_modules/npm/bin/npm-cli.js')].filter(Boolean);
  const cli = candidates.find(file => /\.(?:c?js|mjs)$/i.test(file) && fs.existsSync(file));
  if (!cli) throw new Error('npm CLI was not found. Run this build through npm, or install Node.js with npm and run npm ci --ignore-scripts.');
  // Run npm's JS entry through Node: .cmd executables and shell quoting differ on Windows.
  return { command: executable, args: [cli] };
}

export function ensureBuildDependencies({ root = ROOT, offline = false, run = spawnSync, env = process.env, log = console.log } = {}) {
  const app = readJson(path.join(root, 'package.json')), lock = readJson(path.join(root, 'package-lock.json'));
  if (JSON.stringify(app.dependencies) !== JSON.stringify(expected) || app.optionalDependencies ||
      JSON.stringify(lock.packages?.['']?.dependencies) !== JSON.stringify(expected) ||
      lock.packages?.['node_modules/esbuild-wasm']?.version !== expected['esbuild-wasm']) {
    throw new Error('Unreviewed build dependencies or inconsistent package-lock.json; restore the release package files.');
  }
  if (compilerReady(root)) return path.join(root, 'node_modules/esbuild-wasm');
  const npm = npmCommand({ env });
  log('[build] Preparing esbuild-wasm 0.28.2 with npm ci --ignore-scripts' + (offline ? ' --offline' : '') + ' ...');
  const result = run(npm.command, [...npm.args, 'ci', '--ignore-scripts', '--no-audit', '--no-fund', ...(offline ? ['--offline'] : [])],
    { cwd: root, env, stdio: 'inherit', shell: false });
  if (result.error || result.status !== 0) throw new Error('Build dependencies could not be installed' +
    (offline ? ' from the local npm cache. Run npm ci --ignore-scripts once while online.' : '. Check npm registry/proxy access, then run npm ci --ignore-scripts and retry.') +
    (result.error ? ' ' + result.error.message : ''));
  if (!compilerReady(root)) throw new Error('The installed esbuild-wasm package is incomplete. Run npm ci --ignore-scripts and retry.');
  return path.join(root, 'node_modules/esbuild-wasm');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.slice(2).some(arg => arg !== '--offline')) throw new Error('Usage: node scripts/prepare-dependencies.mjs [--offline]');
    ensureBuildDependencies({ offline: process.argv.includes('--offline') });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
