import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

export function findPython({ env = process.env, platform = process.platform, run = spawnSync } = {}) {
  const candidates = env.AIDOT_PYTHON ? [env.AIDOT_PYTHON] : platform === 'win32' ? ['python', 'python3', 'py'] : ['python3', 'python'];
  for (const command of candidates) {
    const result = run(command, ['--version'], { encoding: 'utf8', env, shell: false });
    if (!result.error && result.status === 0 && /Python 3\./.test((result.stdout || '') + (result.stderr || ''))) return command;
  }
  throw new Error('Python 3 was not found. Install Python 3 and add it to PATH, or set AIDOT_PYTHON to its executable path.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length < 3) throw new Error('Usage: node scripts/run-python.mjs <script or Python options>');
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const result = spawnSync(findPython(), process.argv.slice(2), { cwd: root, stdio: 'inherit', shell: false });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
