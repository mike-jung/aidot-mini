#!/usr/bin/env node
// Default creates a draft in the public repository. Use --dry-run for a local plan only.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT, sha256 } from './dist.mjs';
import { readReleaseEnv, releaseToken, githubCommand, githubCliError, prepareGitHubRelease, createGitHubDraft } from './github-api.mjs';

export function createPlan(directory, { repo, version } = {}) {
  directory = path.resolve(directory);
  version ||= JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Invalid release version');
  if (repo && !/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(repo)) throw new Error('Use --repo owner/repository');
  if (!fs.existsSync(directory)) throw new Error('No verified public release artifacts found. Build dist targets first, or use --directory to select existing artifacts.');
  const sidecars = fs.readdirSync(directory).filter(file => file.endsWith('.release.json')).sort();
  const assets = sidecars.map(sidecar => {
    const file = path.join(directory, sidecar);
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`Linked release sidecar: ${sidecar}`);
    const asset = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (asset.format !== 'aidot-mini-release-artifact/v1' || asset.edition !== 'public' || asset.version !== version) throw new Error(`Non-public or wrong-version release asset: ${sidecar}`);
    if (!asset.file || path.basename(asset.file) !== asset.file || !/^[a-zA-Z0-9][a-zA-Z0-9._-]+$/.test(asset.file) || sidecar !== `${asset.file}.release.json`) throw new Error(`Unsafe asset name: ${sidecar}`);
    if (asset.variant === 'full-source' || /(?:private|enterprise|full-source)/i.test(asset.file)) throw new Error(`Private Full source must not be released publicly: ${asset.file}`);
    const location = path.join(directory, asset.file), stat = fs.lstatSync(location);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== asset.bytes || sha256(fs.readFileSync(location)) !== asset.sha256) throw new Error(`Asset hash/size mismatch: ${asset.file}`);
    return { file: asset.file, bytes: asset.bytes, sha256: asset.sha256, target: asset.target, arch: asset.arch, variant: asset.variant };
  });
  if (!assets.length) throw new Error('No verified public release artifacts found. Build dist targets first.');
  const plan = { format: 'aidot-mini-github-release-plan/v1', version, tag: `v${version}`, repository: repo || null, draft: true, uploadPerformed: false, assets };
  fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), assets.map(asset => `${asset.sha256}  ${asset.file}\n`).join(''));
  fs.writeFileSync(path.join(directory, 'RELEASE_PLAN.json'), JSON.stringify(plan, null, 2) + '\n');
  const notes = `# aidot-mini ${version}\n\nPublic offline runtimes for Windows, Linux, robots and Android, with bundled Node.\n\n- Minimal: headless Note/Product APIs.\n- Full runtime: adds the built-in console and robot client; excludes private publishing tools and Enterprise add-ons.\n- Mutable state lives outside installed application files. Windows Setup supports first-run configuration and optional data cleanup.\n- Android APK filenames identify architecture and signing status. Debug APKs use a test key and are for validation. Release-unsigned APKs require signing with your production keystore before installation or production distribution; the release does not include a production signing key.\n- Consult the release validation report for exact OS and hardware coverage. A produced artifact does not imply every target device was tested.\n\nVerify downloaded bytes using SHA256SUMS.txt. Windows installers are unsigned unless a separate signing step is recorded.\n`;
  fs.writeFileSync(path.join(directory, 'RELEASE_NOTES.md'), notes);
  return plan;
}

function gh(command, args, run, env) {
  const result = run(command, args, { encoding: 'utf8', env, windowsHide: true });
  if (result.error || result.status !== 0) throw githubCliError(result, env);
  return result.stdout;
}

function cliRequest(command, run, env) {
  return async (url, label, { allowNotFound = false } = {}) => {
    const endpoint = url.slice('https://api.github.com/'.length);
    const result = run(command, ['api', '--hostname', 'github.com', '--method', 'GET', '--include', endpoint],
      { encoding: 'utf8', env, windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    if (result.error) throw githubCliError(result, env);
    const response = (result.stdout || '').match(/^HTTP\/\S+ (\d{3})[^\r\n]*\r?\n[\s\S]*?\r?\n\r?\n([\s\S]*)$/);
    // Only a real HTTP 404 is a missing tag. Exit code 1 alone is not enough.
    if (allowNotFound && result.status === 1 && response?.[1] === '404') return undefined;
    if (result.status !== 0) throw githubCliError(result, env);
    if (response?.[1] !== '200') throw new Error(`GitHub CLI ${label} returned an unexpected HTTP response; no draft was created.`);
    try { return JSON.parse(response[2]); }
    catch { throw new Error(`GitHub CLI ${label} returned invalid JSON; no draft was created.`); }
  };
}

export async function main(args = process.argv.slice(2), { run = spawnSync, output = console.log, env = process.env, envRoot = ROOT, fetchImpl = fetch } = {}) {
  const { values } = parseArgs({ args, options: { directory: { type: 'string', default: path.join(ROOT, 'dist/release') }, repo: { type: 'string', default: 'mike-jung/aidot-mini' }, branch: { type: 'string' }, publish: { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false }, help: { type: 'boolean' } } });
  if (values.help) { output('release-github.mjs [--directory DIR] [--repo owner/repository] [--branch BRANCH] [--dry-run]\nDefault: create a draft in mike-jung/aidot-mini from verified public artifacts.\nSet GITHUB_TOKEN (or GH_TOKEN) in .env or the environment; gh is optional.\nWithout a token, use an authenticated GitHub CLI (GH_PATH can locate gh.exe).\nAn existing version tag is reused. If absent, verify the public source version and pin its commit for the draft.\n--branch selects that public source branch (default: PUBLIC_BRANCH or main). Run sync:public first.\n--dry-run writes local plan/checksums only; no GitHub access.\n--repo overrides the destination. --publish remains accepted for compatibility.\nExisting releases are never overwritten.'); return; }
  if (values.publish && values['dry-run']) throw new Error('Choose --publish or --dry-run');
  if (!values.repo) throw new Error('Use --repo owner/repository');
  const directory = path.resolve(values.directory), plan = createPlan(directory, { repo: values.repo });
  const save = () => fs.writeFileSync(path.join(directory, 'RELEASE_PLAN.json'), JSON.stringify(plan, null, 2) + '\n');
  if (!values['dry-run']) {
    const environment = readReleaseEnv(envRoot, env);
    const branch = values.branch ?? (environment.PUBLIC_BRANCH?.trim() || 'main');
    if (releaseToken(environment)) {
      await createGitHubDraft(plan, directory, { env: environment, fetchImpl, save, branch });
    } else {
      environment.GH_HOST = 'github.com';
      const command = githubCommand(environment);
      Object.assign(plan, await prepareGitHubRelease(plan, { request: cliRequest(command, run, environment), branch }));
      save();
      gh(command, ['release', 'create', plan.tag, ...plan.assets.map(asset => path.join(directory, asset.file)), path.join(directory, 'SHA256SUMS.txt'), '--repo', values.repo, '--draft', ...(plan.tagExists ? ['--verify-tag'] : ['--target', plan.targetCommitish]), '--title', `aidot-mini ${plan.version}`, '--notes-file', path.join(directory, 'RELEASE_NOTES.md')], run, environment);
    }
    plan.uploadPerformed = true;
    save();
  }
  output(JSON.stringify(plan, null, 2));
  return plan;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
