// Node-only installer support. Never traverses junctions or deletes an arbitrary tree.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { configuration, configure, noLinks, dataRoot } from '../installed/lifecycle.mjs';

const PAYLOAD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const inventoryName = 'installation-files.json';
const inside = (base, file) => {
  const relative = path.relative(base, file);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};
const exists = value => fs.existsSync(value);

function walk(root, relative = '') {
  noLinks(path.join(root, relative));
  const entries = [];
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Application junctions or symbolic links are not supported: ${name}`);
    if (entry.isDirectory()) entries.push(...walk(root, name));
    else if (entry.isFile() && fs.lstatSync(path.join(root, name)).nlink === 1) entries.push(name);
    else throw new Error(`Application entry is not a private regular file: ${name}`);
  }
  return entries;
}

export function validateInstallPaths(installDir, stateDir) {
  if (!path.isAbsolute(installDir)) throw new Error('Application directory must be absolute');
  const destination = path.resolve(installDir);
  const state = dataRoot(stateDir);
  if (destination === path.parse(destination).root || destination === os.homedir() || inside(destination, state) || inside(state, destination))
    throw new Error('Application and data folders must be separate dedicated directories');
  noLinks(destination);
  if (exists(destination)) walk(destination);
  return { destination, state };
}

function oldInventory(destination) {
  const file = path.join(destination, inventoryName);
  if (!exists(file)) {
    if (exists(destination) && fs.readdirSync(destination).length) throw new Error('Existing application folder has no valid release file inventory');
    return [];
  }
  if (fs.statSync(file).size > 2 * 1024 * 1024) throw new Error('Application inventory is too large');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value.application !== 'aidot-mini' || value.schema !== 1 || !Array.isArray(value.files)) throw new Error('Invalid application inventory');
  return value.files.map(name => {
    if (typeof name !== 'string' || !name || path.isAbsolute(name) || name.includes(':') || name.includes('\\') || name.split('/').some(part => !part || part === '.' || part === '..'))
      throw new Error('Unsafe path in application inventory');
    const target = path.resolve(destination, name);
    if (!inside(destination, target)) throw new Error('Application inventory escaped installation folder');
    return name;
  });
}

function removeEmptyParents(destination, file) {
  let directory = path.dirname(file);
  while (directory !== destination && inside(destination, directory)) {
    try { fs.rmdirSync(directory); } catch (error) {
      if (['ENOTEMPTY', 'EEXIST', 'ENOENT'].includes(error.code)) return;
      throw error;
    }
    directory = path.dirname(directory);
  }
}

export async function installPayload(installDir, stateDir, options, payload = PAYLOAD) {
  const { destination, state } = validateInstallPaths(installDir, stateDir);
  await configure(state, { ...options, validateOnly: true });
  const old = oldInventory(destination);
  const incoming = walk(payload).map(name => name.split(path.sep).join('/'));
  if (!incoming.includes('runtime/node.exe') || !incoming.includes('app/deploy/installed/launch.mjs')) throw new Error('Incomplete Windows payload');
  if (incoming.includes(inventoryName) || incoming.includes('install-state.ini') || incoming.includes('uninstall.exe')) throw new Error('Payload uses a reserved installer filename');
  const previous = new Set(old);
  for (const name of incoming) if (exists(path.join(destination, name)) && !previous.has(name)) throw new Error(`Refusing to overwrite an unrelated file: ${name}`);
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'aidot-mini-install-'));
  const configFile = path.join(state, 'config/installation.json');
  const originalConfig = exists(configFile) ? fs.readFileSync(configFile) : null;
  const originalInventory = exists(path.join(destination, inventoryName)) ? fs.readFileSync(path.join(destination, inventoryName)) : null;
  const changed = new Set();
  try {
    for (const name of old) {
      const source = path.join(destination, name);
      if (!exists(source)) continue;
      const target = path.join(backup, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }
    fs.mkdirSync(destination, { recursive: true });
    for (const name of incoming) {
      const target = path.join(destination, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      changed.add(name);
      fs.copyFileSync(path.join(payload, name), target);
    }
    for (const name of old) if (!incoming.includes(name)) {
      changed.add(name);
      const target = path.join(destination, name);
      fs.rmSync(target, { force: true });
      removeEmptyParents(destination, target);
    }
    // Inventory is committed before configuration, leaving no fallible writes after it.
    fs.writeFileSync(path.join(destination, inventoryName), JSON.stringify({ application: 'aidot-mini', schema: 1, files: incoming }, null, 2) + '\n');
    const result = await configure(state, options);
    return { installed: true, files: incoming.length, ...result };
  } catch (error) {
    for (const name of changed) {
      const saved = path.join(backup, name);
      const target = path.join(destination, name);
      if (exists(saved)) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(saved, target); }
      else { fs.rmSync(target, { force: true }); removeEmptyParents(destination, target); }
    }
    if (originalInventory) fs.writeFileSync(path.join(destination, inventoryName), originalInventory);
    else fs.rmSync(path.join(destination, inventoryName), { force: true });
    if (originalConfig) fs.writeFileSync(configFile, originalConfig);
    throw new Error(`Installation failed; previous application files and settings were restored: ${error.message}`);
  } finally { fs.rmSync(backup, { recursive: true, force: true }); }
}

export async function main(args = process.argv.slice(2)) {
  const command = args.shift();
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!['--data-dir', '--install-dir', '--output', '--port', '--database', '--profile'].includes(key) || values[key] !== undefined || !value)
      throw new Error(`Invalid setup option: ${key}`);
    values[key] = value;
  }
  if (command === 'config-ini') {
    const info = configuration(values['--data-dir']);
    const output = values['--output'];
    if (!output || !path.isAbsolute(output)) throw new Error('INI output path must be absolute');
    const content = `[aidot-mini]\r\nport=${info.port}\r\ndatabase=${info.database}\r\nprofile=${info.profile}\r\n`;
    fs.writeFileSync(output, content, { flag: 'wx' });
    return;
  }
  const { destination, state } = validateInstallPaths(values['--install-dir'], values['--data-dir']);
  if (command === 'validate-paths') { console.log(JSON.stringify({ valid: true, installDir: destination, dataDir: state })); return; }
  if (!['preflight', 'install'].includes(command)) throw new Error(`Unknown setup command: ${command}`);
  const options = { port: Number(values['--port']), database: values['--database'], profile: values['--profile'] };
  if (command === 'preflight') {
    oldInventory(destination);
    console.log(JSON.stringify(await configure(state, { ...options, validateOnly: true })));
  } else console.log(JSON.stringify(await installPayload(destination, state, options)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { console.error(`aidot-mini setup: ${error.message}`); process.exitCode = 1; });
