// Copyright 2026 Aidot Link Co., Ltd. SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

// Match the existing source-publishing configuration without importing private tools.
export function readReleaseEnv(root, inherited = process.env) {
  const saved = {};
  for (const name of ['.env.publish', '.env', '.env.local']) {
    const file = path.join(root, name);
    if (fs.existsSync(file)) Object.assign(saved, parseEnv(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')));
  }
  const env = { ...saved, ...inherited };
  for (const name of ['GITHUB_TOKEN', 'GH_TOKEN']) {
    if (/[\r\n\0]/.test(env[name] || '')) throw new Error(`${name} must be a single line.`);
  }
  return env;
}

export const releaseToken = env => (env.GITHUB_TOKEN || '').trim() || (env.GH_TOKEN || '').trim();

export function redactReleaseError(value, env) {
  let text = String(value || '');
  for (const token of [env.GITHUB_TOKEN, env.GH_TOKEN].filter(Boolean)) {
    for (const variant of [token, token.trim(), encodeURIComponent(token), Buffer.from(token).toString('base64')]) {
      if (variant) text = text.split(variant).join('[REDACTED]');
    }
  }
  return text.replace(/\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]+/g, '[REDACTED]').slice(0, 2000);
}

export function githubCommand(env, platform = process.platform) {
  if (env.GH_PATH?.trim()) return env.GH_PATH.trim();
  if (platform === 'win32') {
    const candidates = [env.ProgramFiles && path.join(env.ProgramFiles, 'GitHub CLI', 'gh.exe'),
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'GitHub CLI', 'gh.exe')];
    for (const file of candidates.filter(Boolean)) if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return 'gh';
}

export function githubCliError(result, env) {
  if (result.error?.code === 'ENOENT' || /spawn(?:Sync)? .*ENOENT/.test(result.error?.message || '')) {
    return new Error('GitHub CLI (gh) was not found.\n'
      + 'Set GITHUB_TOKEN (or GH_TOKEN) in the project .env or environment to release without gh.\n'
      + 'The token needs Contents: Read and write for the destination repository.\n'
      + 'Alternatively on Windows: winget install --id GitHub.cli --exact\n'
      + 'Then open a new terminal and run: gh auth login --hostname github.com\n'
      + 'For an existing installation outside PATH, set GH_PATH to its gh.exe path.');
  }
  return new Error('GitHub CLI failed: ' + redactReleaseError(result.error?.message || result.stderr || result.stdout, env)
    + '\nCheck gh auth status --hostname github.com, or configure GITHUB_TOKEN in .env.');
}

// Both authentication paths use the same read-only preflight. Never turn an
// authentication/network error into permission to create a release or a tag.
export async function prepareGitHubRelease(plan, { request, branch = 'main' }) {
  const base = `https://api.github.com/repos/${plan.repository}`;
  // Authenticated lists include drafts; the public release-by-tag endpoint does not.
  for (let page = 1; ; page++) {
    if (page > 100) throw new Error('Too many release pages to check safely; no draft was created.');
    const releases = await request(`${base}/releases?per_page=100&page=${page}`, 'release lookup');
    if (!Array.isArray(releases)) throw new Error('Invalid GitHub release list; no draft was created.');
    if (releases.some(release => release.tag_name === plan.tag)) {
      throw new Error(`Release ${plan.tag} already exists; review it manually instead of overwriting.`);
    }
    if (releases.length < 100) break;
  }
  const tag = await request(`${base}/git/ref/tags/${encodeURIComponent(plan.tag)}`, `tag lookup for ${plan.tag}`, { allowNotFound: true });
  if (tag !== undefined) {
    if (tag?.ref !== `refs/tags/${plan.tag}` || !['commit', 'tag'].includes(tag.object?.type) || !/^[a-f0-9]{40}$/i.test(tag.object?.sha || '')) {
      throw new Error(`Remote tag ${plan.tag} was not confirmed; no draft was created.`);
    }
    return { tagExists: true };
  }

  branch = branch.trim();
  if (!branch || /[\x00-\x20\x7f]/.test(branch) || branch.startsWith('-')) throw new Error('Use --branch with the public source branch name.');
  const repository = await request(base, 'repository lookup');
  if (repository?.private !== false || repository.full_name?.toLowerCase() !== plan.repository.toLowerCase()) {
    throw new Error('Missing-tag releases require the intended public repository; check --repo.');
  }
  const head = await request(`${base}/git/ref/heads/${encodeURIComponent(branch)}`, `public branch lookup for ${branch}`, { allowNotFound: true });
  if (head?.ref !== `refs/heads/${branch}` || head.object?.type !== 'commit' || !/^[a-f0-9]{40}$/i.test(head.object?.sha || '')) {
    throw new Error(`Public branch ${branch} was not confirmed. Run npm run sync:public first, or select --branch. No draft was created.`);
  }
  const sha = head.object.sha;
  // Read by the resolved SHA, so a later branch push cannot change the checked source.
  const file = await request(`${base}/contents/package.json?ref=${sha}`, 'public source version lookup', { allowNotFound: true });
  let source;
  try {
    if (file?.type !== 'file' || file.path !== 'package.json' || file.encoding !== 'base64' || typeof file.content !== 'string') throw new Error();
    source = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
  } catch {
    throw new Error('Public package.json could not be verified. Run npm run sync:public first. No draft was created.');
  }
  if (source?.name !== 'aidot-mini' || source.aidotEdition !== 'public' || source.version !== plan.version) {
    throw new Error(`Public source must be aidot-mini ${plan.version} with aidotEdition=public. Run npm run sync:public for this version before releasing. No draft was created.`);
  }
  // GitHub manages the tag for the draft. Do not push a local Full-source tag,
  // move an existing tag, or claim that a draft has already published its tag.
  return { tagExists: false, sourceBranch: branch, targetCommitish: sha };
}

export async function createGitHubDraft(plan, directory, { env, fetchImpl = fetch, save = () => {}, branch = 'main' }) {
  const token = releaseToken(env), base = `https://api.github.com/repos/${plan.repository}`;
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'aidot-mini-release' };
  async function request(url, label, { method = 'GET', body, upload = false, expected = 200, allowNotFound = false } = {}) {
    let response;
    try {
      response = await fetchImpl(url, { method, redirect: 'error', signal: AbortSignal.timeout(upload ? 600000 : 30000),
        headers: { ...headers, ...(body ? { 'Content-Type': upload ? 'application/octet-stream' : 'application/json' } : {}),
          ...(upload ? { 'Content-Length': String(body.size) } : {}) }, body });
    } catch (error) {
      throw new Error(`GitHub ${label} failed: ${redactReleaseError(error.message, env)}. Check network, proxy and certificate trust.`);
    }
    let data;
    try { data = await response.json(); } catch { throw new Error(`GitHub ${label} returned HTTP ${response.status} without a JSON response.`); }
    if (allowNotFound && response.status === 404) return undefined;
    if (response.status !== expected) {
      const hint = response.status === 401 ? 'Check token validity.'
        : response.status === 403 ? 'Check token repository access, Contents: Read and write, and API rate limits.'
          : response.status === 404 ? 'Check the repository or ref, and token access to it.' : 'Review the GitHub response before retrying.';
      throw new Error(`GitHub ${label} failed (HTTP ${response.status}): ${redactReleaseError(data?.message || 'Request rejected', env)} ${hint}`);
    }
    return data;
  }

  Object.assign(plan, await prepareGitHubRelease(plan, { request, branch }));
  save();
  const release = await request(`${base}/releases`, 'draft creation', { method: 'POST', expected: 201,
    body: JSON.stringify({ tag_name: plan.tag, name: `aidot-mini ${plan.version}`, draft: true,
      ...(plan.targetCommitish ? { target_commitish: plan.targetCommitish } : {}),
      body: fs.readFileSync(path.join(directory, 'RELEASE_NOTES.md'), 'utf8') }) });
  if (!Number.isSafeInteger(release?.id) || release.id <= 0 || release.draft !== true || release.tag_name !== plan.tag) {
    throw new Error('Unexpected GitHub draft response; inspect the repository before retrying.');
  }
  plan.releaseId = release.id;
  plan.releaseUrl = `https://github.com/${plan.repository}/releases`;
  plan.draftCreated = true;
  plan.uploadedAssets = [];
  save();
  try {
    const uploadUrl = new URL(String(release.upload_url).replace(/\{[^}]*\}$/, ''));
    if (uploadUrl.origin !== 'https://uploads.github.com' || uploadUrl.username || uploadUrl.password || uploadUrl.search || uploadUrl.hash
      || uploadUrl.pathname.toLowerCase() !== `/repos/${plan.repository}/releases/${release.id}/assets`.toLowerCase()) {
      throw new Error('Unexpected GitHub upload URL; credentials were not sent to it.');
    }
    const files = [...plan.assets, { file: 'SHA256SUMS.txt', bytes: fs.statSync(path.join(directory, 'SHA256SUMS.txt')).size }];
    for (const asset of files) {
      const body = await fs.openAsBlob(path.join(directory, asset.file));
      if (body.size !== asset.bytes) throw new Error(`Asset size changed before upload: ${asset.file}`);
      const url = new URL(uploadUrl); url.searchParams.set('name', asset.file);
      const uploaded = await request(url.href, `upload of ${asset.file}`, { method: 'POST', body, upload: true, expected: 201 });
      if (uploaded.name !== asset.file || uploaded.size !== asset.bytes || uploaded.state !== 'uploaded'
        || asset.sha256 && uploaded.digest && uploaded.digest !== `sha256:${asset.sha256}`) {
        throw new Error(`GitHub upload verification failed: ${asset.file}`);
      }
      plan.uploadedAssets.push(asset.file);
      save();
    }
  } catch (error) {
    throw new Error(`${redactReleaseError(error.message, env)}\nDraft ${plan.tag} was created but upload is incomplete. Review ${plan.releaseUrl} before retrying; existing releases are never overwritten.`);
  }
}
