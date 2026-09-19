import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function findMakensis({ explicit, env = process.env, platform = process.platform, run = spawnSync } = {}) {
  const candidates = explicit ? [explicit] : env.MAKENSIS ? [env.MAKENSIS] : ['makensis',
    ...(env.NSIS_HOME ? [path.join(env.NSIS_HOME, 'makensis.exe')] : []),
    ...(platform === 'win32' ? [path.win32.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'NSIS', 'makensis.exe'),
      path.win32.join(env.ProgramFiles || 'C:\\Program Files', 'NSIS', 'makensis.exe')] : [])];
  for (const command of candidates) {
    const result = run(command, ['-VERSION'], { encoding: 'utf8', env, shell: false });
    if (!result.error && result.status === 0 && /v?3\./.test((result.stdout || '') + (result.stderr || ''))) return command;
  }
  throw new Error('NSIS 3 is required for a Windows installer. Install NSIS, or pass --makensis "C:\\Program Files (x86)\\NSIS\\makensis.exe". Use --no-installer only when you want a portable ZIP without an installer.');
}

export function androidToolchain(root, { env = process.env, platform = process.platform, run = spawnSync } = {}) {
  const executable = name => env.JAVA_HOME ? path.join(env.JAVA_HOME, 'bin', name + (platform === 'win32' ? '.exe' : '')) : name;
  for (const name of ['java', 'javac']) {
    const result = run(executable(name), ['-version'], { encoding: 'utf8', env, shell: false });
    const match = ((result.stdout || '') + (result.stderr || '')).match(/(?:version\s+"|javac\s+)(\d+)/);
    if (result.error || result.status !== 0 || !match || Number(match[1]) < 17) {
      throw new Error('Android APK builds require JDK 17 or later, including javac. Set JAVA_HOME to the JDK directory and retry.');
    }
  }
  let sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
  const localProperties = path.join(root, 'android/local.properties');
  if (!sdk && fs.existsSync(localProperties)) {
    const value = fs.readFileSync(localProperties, 'utf8').match(/^\s*sdk\.dir\s*=\s*(.+)$/m)?.[1]?.trim();
    if (value) sdk = value.replace(/\\([\\:= ])/g, '$1');
  }
  if (!sdk || !fs.existsSync(path.join(sdk, 'platforms/android-36/android.jar'))) {
    throw new Error('Android SDK platform 36 was not found. Install platforms;android-36 and build-tools;35.0.0 with the Android SDK manager, then set ANDROID_HOME or android/local.properties. Use --prepare-only for server assets without an APK.');
  }
  return { java: executable('java'), sdk };
}
