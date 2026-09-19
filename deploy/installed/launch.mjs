#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { defaultDataDir, configure, configuration, status, start, stop, uninstall, administration } from './lifecycle.mjs';

export function parseArguments(args) {
  const command = args.shift() || 'start';
  if (!['configure', 'config', 'status', 'start', 'stop', 'uninstall', 'help', 'account', 'token'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const result = { command, dataDir: undefined, options: {}, accountArgs: [] };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (seen.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    seen.add(flag);
    if (['--stdin', '--reset'].includes(flag) && command === 'account') { result.accountArgs.push(flag); continue; }
    if (flag === '--robot' && command === 'start') { result.options.robot = true; continue; }
    if (flag === '--validate-only' && command === 'configure') { result.options.validateOnly = true; continue; }
    if (flag === '--purge' && command === 'uninstall') { result.options.purge = true; continue; }
    const key = { '--data-dir': 'dataDir', '--port': 'port', '--host': 'host', '--database': 'database', '--profile': 'profile', '--tls-cert': 'tlsCert', '--tls-key': 'tlsKey' }[flag];
    if (!key || (command !== 'configure' && key !== 'dataDir')) throw new Error(`Unsupported ${command} option: ${flag}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (key === 'dataDir') result.dataDir = value;
    else result.options[key] = key === 'port' ? (/^\d+$/.test(value) ? Number(value) : NaN) : value;
  }
  result.dataDir ??= defaultDataDir();
  return result;
}
export async function main(args = process.argv.slice(2)) {
  const { command, dataDir, options, accountArgs } = parseArguments([...args]);
  if (command === 'help') {
    console.log('aidot-mini configure [--port 8901] [--host 127.0.0.1] [--database app.db] [--profile note|product] [--tls-cert FILE --tls-key FILE]\naidot-mini start [--robot] | stop | status | config\naidot-mini account [--stdin] [--reset] | token\naidot-mini uninstall [--purge]\nAll commands accept --data-dir ABSOLUTE_DIRECTORY. Default state: LOCALAPPDATA/aidot-mini on Windows; XDG_DATA_HOME/aidot-mini on Linux.');
    return;
  }
  if (command === 'start') return start(dataDir, options);
  if (command === 'account' || command === 'token') return administration(dataDir, command, accountArgs);
  const result = await ({ configure: () => configure(dataDir, options), config: () => configuration(dataDir), status: () => status(dataDir), stop: () => stop(dataDir), uninstall: () => uninstall(dataDir, options) })[command]();
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(`aidot-mini: ${error.message}`); process.exitCode = 1; });
