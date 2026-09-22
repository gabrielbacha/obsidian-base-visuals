import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [bundle, manifestSource, packageSource] = await Promise.all([
  readFile(new URL('../main.js', import.meta.url), 'utf8'),
  readFile(new URL('../manifest.json', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8'),
]);
const manifest = JSON.parse(manifestSource);
const packageJson = JSON.parse(packageSource);

assert.equal(manifest.version, packageJson.version, 'manifest and package versions must match');
assert.ok(bundle.length > 100_000, 'production bundle is unexpectedly small');
assert.match(bundle, /basesVisualsView/, 'view schema is absent from the production bundle');
assert.match(bundle, /columnAppearances/, 'v2 column appearances are absent from the production bundle');

console.log(`Bundle smoke passed for Bases Visuals ${manifest.version} (${bundle.length} bytes).`);
