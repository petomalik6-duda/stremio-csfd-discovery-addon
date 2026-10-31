import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const port = 19123;
const child = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(port), TMDB_API_KEY: '', TMDB_READ_ACCESS_TOKEN: '' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let stderr = '';
child.stderr.on('data', chunk => { stderr += String(chunk); });

async function waitForHealth() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return res.json();
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Server did not become healthy. ${stderr}`);
}

try {
  const health = await waitForHealth();
  assert.equal(health.ok, true);
  assert.equal(health.tmdbConfigured, false);
  assert.equal(health.peopleEnabled, true);

  const manifestRes = await fetch(`http://127.0.0.1:${port}/manifest.json`);
  assert.equal(manifestRes.ok, true);
  const manifest = await manifestRes.json();
  assert.equal(manifest.id, 'cz.csfd.discovery.v1');
  assert.equal(manifest.version, pkg.version);
  assert.ok(Array.isArray(manifest.catalogs));
  assert.ok(manifest.types.includes('person'));

  const peopleCatalog = manifest.catalogs.find(c => c.type === 'person' && c.id === 'csfd-people');
  assert.ok(peopleCatalog);
  assert.ok(peopleCatalog.extra?.some(e => e.name === 'search' && e.isRequired === true));

  const metaResource = manifest.resources.find(r => typeof r === 'object' && r.name === 'meta');
  assert.ok(metaResource);
  assert.ok(metaResource.types.includes('person'));
  assert.ok(metaResource.idPrefixes.includes('person:'));

  console.log('Smoke test passed:', {
    version: manifest.version,
    catalogs: manifest.catalogs.length,
    addon: manifest.name,
    peopleCatalog: peopleCatalog.name
  });
} finally {
  child.kill('SIGTERM');
}
