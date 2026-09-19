import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// The APK embeds a Bionic/Android Node runtime, never a desktop Linux executable.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flags = new Set(['--prepare-only', '--offline', '--debug-only']);
let abis = ['arm64-v8a', 'x86_64'];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--abi') {
    abis = (args[++i] || '').split(',');
    if (!abis.length || abis.some(abi => !['arm64-v8a', 'x86_64'].includes(abi))) throw new Error('--abi accepts arm64-v8a,x86_64');
  } else if (!flags.has(args[i])) throw new Error('Unknown Android distribution argument: ' + args[i]);
}
const python = process.env.AIDOT_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
function run(command, argv, options = {}) {
  const result = spawnSync(command, argv, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}
run(python, ['android/scripts/check-android.py']);
const cache = path.resolve(process.env.AIDOT_ANDROID_RUNTIME_CACHE || path.join(root, 'dist/.cache/android-runtime'));
for (const abi of new Set(abis)) {
  run(python, ['android/scripts/import-runtime.py', '--abi', abi, '--cache', cache, ...(args.includes('--offline') ? [] : ['--download'])]);
}
run(python, ['android/scripts/build-assets.py']);
run(python, ['android/scripts/check-runtime.py']);
if (!args.includes('--prepare-only')) {
  if (!(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT) && !await fs.access(path.join(root, 'android/local.properties')).then(() => true, () => false)) {
    throw new Error('Set ANDROID_HOME to an Android SDK with platform 36 and build tools, or create android/local.properties. Java 17+ is also required.');
  }
  const tasks = [':app:assembleDebug', ...(args.includes('--debug-only') ? [] : [':app:assembleRelease'])];
  const gradleArgs = [...tasks, '--no-daemon', '-PaidotAbis=' + abis.join(','), '-PaidotPython=' + python];
  // Invoke the official wrapper's Java entry directly: cmd.exe adds literal quotes to
  // Gradle task names when a .bat command is nested inside Node's Windows quoting.
  const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
  run(java, ['-Dorg.gradle.appname=gradlew', '-classpath', path.join(root, 'android/gradle/wrapper/gradle-wrapper.jar'), 'org.gradle.wrapper.GradleWrapperMain', ...gradleArgs], { cwd: path.join(root, 'android') });
  const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const output = path.join(root, 'dist/release');
  await fs.mkdir(output, { recursive: true });
  const manifest = { version, runtime: JSON.parse(await fs.readFile(path.join(root, 'android/runtime-manifest.json'), 'utf8')).nodeVersion, artifacts: [] };
  for (const type of args.includes('--debug-only') ? ['debug'] : ['debug', 'release']) {
    const folder = path.join(root, 'android/app/build/outputs/apk', type);
    const metadata = JSON.parse(await fs.readFile(path.join(folder, 'output-metadata.json'), 'utf8'));
    for (const item of metadata.elements) {
      const abi = item.filters.find(filter => filter.filterType === 'ABI')?.value;
      if (!abis.includes(abi)) continue;
      if (item.versionName !== version) throw new Error('Stale APK version in Gradle output');
      const signed = type === 'debug' || Boolean(process.env.AIDOT_ANDROID_KEYSTORE);
      const name = `aidot-mini-${version}-android-${abi}-${type}${signed ? '' : '-unsigned'}.apk`;
      const content = await fs.readFile(path.join(folder, item.outputFile));
      await fs.writeFile(path.join(output, name), content);
      const artifact = { name, abi, type, signed, signing: type === 'debug' ? 'Android debug key: verification only' : signed ? 'User-supplied release key' : 'Unsigned: sign with your release key before installation or publication', bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') };
      manifest.artifacts.push(artifact);
      await fs.writeFile(path.join(output, name + '.release.json'), JSON.stringify({ format: 'aidot-mini-release-artifact/v1', file: name, bytes: artifact.bytes, sha256: artifact.sha256, version, edition: 'public', target: 'android', arch: abi, variant: type === 'debug' ? 'debug' : signed ? 'release' : 'release-unsigned', signed, signing: artifact.signing }, null, 2) + '\n');
    }
  }
  if (manifest.artifacts.length !== new Set(abis).size * tasks.length) throw new Error('Missing expected Android APK output');
  await fs.writeFile(path.join(output, 'android-build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify(manifest, null, 2));
}
