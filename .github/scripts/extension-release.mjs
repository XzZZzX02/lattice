import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFile, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const bundleFiles = ['INSTALL.md', 'background.js', 'content.js', 'manifest.json', 'native.css'];
const digest = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');

export function releaseMetadata(manifest, sha) {
  const version = manifest.version;
  assert(typeof version === 'string' && /^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/.test(version), 'Invalid extension version');
  const parts = version.split('.').map(Number);
  assert(parts.every(part => part <= 65535) && parts.some(part => part > 0), 'Invalid extension version');
  assert(/^[a-f0-9]{40}$/.test(sha), 'Release must target an exact commit');
  return { version, sha, tag: `extension-v${version}`, asset: `lattice-chatgpt-extension-${version}.zip` };
}

export async function planRelease(meta, api) {
  const release = await api(`/releases/tags/${meta.tag}`, { missing: true });
  if (release && !release.draft) return { should_release: false, release };
  const ref = await api(`/git/ref/tags/${meta.tag}`, { missing: true });
  let target = ref?.object;
  if (target?.type === 'tag') target = (await api(`/git/tags/${target.sha}`)).object;
  if (target) assert(target.type === 'commit' && target.sha === meta.sha, 'Tag already points to another commit; bump the extension version');
  return { should_release: true, release, tagged: !!ref };
}

export function verifyArchive(path, version) {
  const names = execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(names.sort(), bundleFiles, 'ZIP must contain only runtime files and INSTALL.md; no ACCEPTANCE.md');
  const manifest = JSON.parse(execFileSync('unzip', ['-p', path, 'manifest.json'], { encoding: 'utf8' }));
  assert.equal(manifest.version, version, 'ZIP manifest version differs from release');
}

export async function prepareRelease(meta, root = process.cwd()) {
  const folder = resolve(root, 'release');
  const source = resolve(root, 'artifacts/lattice-chatgpt-extension.zip');
  verifyArchive(source, meta.version);
  await mkdir(folder, { recursive: true });
  await copyFile(source, resolve(folder, meta.asset));
  const checksum = digest(await readFile(source));
  await writeFile(resolve(folder, 'SHA256SUMS'), `${checksum.slice(7)}  ${meta.asset}\n`);
  const notesPath = resolve(root, `.github/release-notes/${meta.tag}.md`);
  let notes;
  try { notes = await readFile(notesPath, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    notes = `Lattice for ChatGPT ${meta.version}\n\n版本改动见下方自动生成的提交记录。\n`;
  }
  notes += '\n## 安装与更新\n\n下载 ZIP 后解压，在 Chrome/Edge 的扩展管理页面开启开发者模式，加载包含 manifest.json 的文件夹。已安装的用户替换原目录后点击“重新加载”，再刷新 ChatGPT。安装包不包含 ACCEPTANCE.md。\n';
  notes += `\nSHA-256: \`${checksum.slice(7)}\`\n`;
  await writeFile(resolve(folder, 'notes.md'), notes);
  await writeFile(resolve(folder, 'metadata.json'), JSON.stringify({ ...meta, checksum }) + '\n');
}

export async function publishRelease(meta, api, root = process.cwd()) {
  const plan = await planRelease(meta, api);
  if (!plan.should_release) return plan.release;
  const folder = resolve(root, 'release');
  const prepared = JSON.parse(await readFile(resolve(folder, 'metadata.json'), 'utf8'));
  for (const key of ['version', 'sha', 'tag', 'asset']) assert.equal(prepared[key], meta[key], 'Build metadata differs from release commit');
  const zipPath = resolve(folder, meta.asset);
  verifyArchive(zipPath, meta.version);
  const zip = await readFile(zipPath);
  assert.equal(digest(zip), prepared.checksum, 'ZIP checksum mismatch');
  const sums = await readFile(resolve(folder, 'SHA256SUMS'));
  assert.equal(sums.toString(), `${prepared.checksum.slice(7)}  ${meta.asset}\n`, 'SHA256SUMS mismatch');
  const body = await readFile(resolve(folder, 'notes.md'), 'utf8');
  if (!plan.tagged) await api('/git/refs', { method: 'POST', data: { ref: `refs/tags/${meta.tag}`, sha: meta.sha } });
  const generated = await api('/releases/generate-notes', { method: 'POST', data: { tag_name: meta.tag, target_commitish: meta.sha } });
  const releaseBody = body + '\n' + generated.body;
  let release = plan.release;
  if (!release) {
    release = await api('/releases', { method: 'POST', data: {
      tag_name: meta.tag, target_commitish: meta.sha, name: `Lattice for ChatGPT ${meta.version}`,
      body: releaseBody, draft: true, prerelease: false
    } });
  } else {
    release = await api(`/releases/${release.id}`, { method: 'PATCH', data: { body: releaseBody } });
  }
  assert(release.draft, 'Only draft releases may have assets changed');
  const assets = [{ name: meta.asset, bytes: zip, type: 'application/zip' }, { name: 'SHA256SUMS', bytes: sums, type: 'text/plain' }];
  for (const asset of assets) {
    const existing = release.assets.find(entry => entry.name === asset.name);
    if (existing?.state === 'uploaded' && existing.digest === digest(asset.bytes) && existing.size === asset.bytes.length) continue;
    if (existing) await api(`/releases/assets/${existing.id}`, { method: 'DELETE' });
    const url = new URL(release.upload_url.split('{')[0]);
    url.searchParams.set('name', asset.name);
    const uploaded = await api(url.href, { method: 'POST', bytes: asset.bytes, type: asset.type });
    assert(uploaded.state === 'uploaded' && uploaded.size === asset.bytes.length, 'Incomplete release asset upload');
    if (uploaded.digest) assert.equal(uploaded.digest, digest(asset.bytes), 'Uploaded asset digest mismatch');
  }
  release = await api(`/releases/${release.id}`);
  for (const asset of assets) {
    const uploaded = release.assets.find(entry => entry.name === asset.name);
    assert(uploaded?.state === 'uploaded' && uploaded.size === asset.bytes.length, 'Release asset is missing');
    if (uploaded.digest) assert.equal(uploaded.digest, digest(asset.bytes));
  }
  return api(`/releases/${release.id}`, { method: 'PATCH', data: { draft: false, make_latest: 'true' } });
}

function githubApi(repo, token) {
  assert(/^[\w.-]+\/[\w.-]+$/.test(repo), 'Missing GitHub repository');
  assert(token, 'Missing GitHub token');
  return async (path, options = {}) => {
    const url = new URL(path.startsWith('https://') ? path : `https://api.github.com/repos/${repo}${path}`);
    assert(['api.github.com', 'uploads.github.com'].includes(url.hostname) && url.protocol === 'https:', 'Unexpected GitHub API host');
    const response = await fetch(url, {
      method: options.method ?? 'GET', redirect: 'error', signal: AbortSignal.timeout(60_000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': options.type ?? 'application/json' },
      body: options.bytes ?? (options.data ? JSON.stringify(options.data) : undefined)
    });
    if (response.status === 404 && options.missing) return null;
    if (!response.ok) throw new Error(`GitHub ${options.method ?? 'GET'} ${url.pathname}: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
}

async function main() {
  const manifest = JSON.parse(await readFile('extension/public/manifest.json', 'utf8'));
  const meta = releaseMetadata(manifest, process.env.GITHUB_SHA);
  const mode = process.argv[2];
  if (mode === 'prepare') {
    await prepareRelease(meta);
    console.log(`Prepared ${meta.asset}`);
    return;
  }
  const api = githubApi(process.env.GITHUB_REPOSITORY, process.env.GH_TOKEN);
  if (mode === 'plan') {
    const { should_release } = await planRelease(meta, api);
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${meta.version}\nshould_release=${should_release}\n`);
    const message = `${meta.tag}: ${should_release ? 'will build and publish' : 'already published; skipped'}`;
    console.log(message);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, message + '\n');
  } else if (mode === 'publish') {
    const release = await publishRelease(meta, api);
    assert(!release.draft && release.published_at, 'Release was not published');
    console.log(release.html_url);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `[${meta.tag}](${release.html_url})\n`);
  } else throw new Error('Expected plan, prepare, or publish');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
