import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { planRelease, prepareRelease, publishRelease, releaseMetadata, verifyArchive } from './extension-release.mjs';

const meta = releaseMetadata({ version: '0.4.1' }, 'a'.repeat(40));
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'lattice-release-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = resolve(root, 'dist');
  await mkdir(files);
  await mkdir(resolve(root, 'artifacts'));
  for (const name of ['INSTALL.md', 'background.js', 'content.js', 'native.css']) await writeFile(resolve(files, name), 'fixture');
  await writeFile(resolve(files, 'manifest.json'), JSON.stringify({ version: meta.version }));
  execFileSync('zip', ['-q', '-r', resolve(root, 'artifacts/lattice-chatgpt-extension.zip'), '.'], { cwd: files });
  return root;
}

function github({ failUpload = false } = {}) {
  let ref = null;
  let release = null;
  const calls = [];
  const api = async (path, options = {}) => {
    calls.push({ path, ...options });
    const method = options.method ?? 'GET';
    if (path.startsWith('/releases/tags/')) return release;
    if (path.startsWith('/git/ref/tags/')) return ref;
    if (path === '/git/refs') { ref = { object: { type: 'commit', sha: options.data.sha } }; return ref; }
    if (path === '/releases/generate-notes') return { body: 'Generated change list' };
    if (path === '/releases' && method === 'POST') {
      release = { ...options.data, id: 7, assets: [], upload_url: 'https://uploads.github.com/repos/owner/repo/releases/7/assets{?name,label}', html_url: 'https://github.com/owner/repo/releases/tag/' + meta.tag };
      return release;
    }
    if (path.startsWith('https://uploads.github.com/')) {
      if (failUpload) { failUpload = false; throw new Error('simulated interrupted upload'); }
      const asset = { id: release.assets.length + 1, name: new URL(path).searchParams.get('name'), state: 'uploaded', size: options.bytes.length, digest: hash(options.bytes) };
      release.assets.push(asset);
      return asset;
    }
    if (path.startsWith('/releases/assets/') && method === 'DELETE') {
      release.assets = release.assets.filter(asset => asset.id !== Number(path.split('/').at(-1)));
      return null;
    }
    if (path === '/releases/7' && method === 'PATCH') {
      release = { ...release, ...options.data, ...(options.data.draft === false ? { published_at: '2026-10-19T00:00:00Z' } : {}) };
      return release;
    }
    if (path === '/releases/7') return release;
    throw new Error('Unexpected API call: ' + path);
  };
  return { api, calls };
}

test('accepts Chrome versions and rejects invalid versions and non-commit targets', () => {
  assert.equal(meta.tag, 'extension-v0.4.1');
  for (const version of ['0', '0.0.0', '01.2', '1.65536', '1.2.3.4.5', '1.2-beta', '../1.2']) {
    assert.throws(() => releaseMetadata({ version }, meta.sha));
  }
  assert.throws(() => releaseMetadata({ version: '1.0' }, 'main'));
  assert.equal(releaseMetadata({ version: '1.2.3.4' }, meta.sha).version, '1.2.3.4');
});

test('skips published releases without touching tags or assets', async () => {
  const calls = [];
  const result = await planRelease(meta, async path => { calls.push(path); return { draft: false }; });
  assert.equal(result.should_release, false);
  assert.equal(calls.length, 1);
});

test('refuses a conflicting existing tag, including annotated tags', async () => {
  await assert.rejects(planRelease(meta, async path => {
    if (path.startsWith('/releases/')) return null;
    if (path.startsWith('/git/ref/')) return { object: { type: 'tag', sha: 'b'.repeat(40) } };
    return { object: { type: 'commit', sha: 'c'.repeat(40) } };
  }), /another commit/);
});

test('prepares a versioned ZIP and checksum, excluding acceptance documents', async t => {
  const root = await fixture(t);
  await prepareRelease(meta, root);
  const zip = await readFile(resolve(root, 'release', meta.asset));
  const metadata = JSON.parse(await readFile(resolve(root, 'release/metadata.json'), 'utf8'));
  assert.equal(metadata.checksum, hash(zip));
  assert.match(await readFile(resolve(root, 'release/notes.md'), 'utf8'), /安装与更新/);
  await writeFile(resolve(root, 'dist/ACCEPTANCE.md'), 'must not ship');
  execFileSync('zip', ['-q', resolve(root, 'artifacts/lattice-chatgpt-extension.zip'), 'ACCEPTANCE.md'], { cwd: resolve(root, 'dist') });
  assert.throws(() => verifyArchive(resolve(root, 'artifacts/lattice-chatgpt-extension.zip'), meta.version), /only runtime files/);
});

test('does not publish incomplete assets; resumes the same draft and makes reruns read-only', async t => {
  const root = await fixture(t);
  await prepareRelease(meta, root);
  const fake = github({ failUpload: true });
  await assert.rejects(publishRelease(meta, fake.api, root), /interrupted upload/);
  assert.equal(fake.calls.some(call => call.method === 'PATCH'), false);
  const published = await publishRelease(meta, fake.api, root);
  assert.equal(published.draft, false);
  assert.deepEqual(published.assets.map(asset => asset.name), [meta.asset, 'SHA256SUMS']);
  assert.equal(fake.calls.filter(call => call.path === '/releases' && call.method === 'POST').length, 1);
  const count = fake.calls.length;
  await publishRelease(meta, fake.api, root);
  assert.equal(fake.calls.length, count + 1);
});

test('rejects a mismatched ZIP version and tampered build checksums before mutations', async t => {
  const root = await fixture(t);
  assert.throws(() => verifyArchive(resolve(root, 'artifacts/lattice-chatgpt-extension.zip'), '0.4.2'), /manifest version/);
  await prepareRelease(meta, root);
  await writeFile(resolve(root, 'release/SHA256SUMS'), 'tampered');
  const fake = github();
  await assert.rejects(publishRelease(meta, fake.api, root), /SHA256SUMS mismatch/);
  assert.equal(fake.calls.some(call => call.method), false);
});
