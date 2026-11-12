// Compatibility copy: canonical v2 names.ts owns this file. No handwritten edits to the copy.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonical = path.resolve(root, '../../../../../_Supporting/bases-contract-NPM/src/names.ts');
const generated = path.join(root, 'src/generated/portable-names.ts');
const metadata = path.join(root, 'scripts/filename-contract.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (process.argv.includes('--update')) {
  const source = await readFile(canonical);
  await writeFile(generated, source);
  await writeFile(metadata, JSON.stringify({owner: 'Applications-GB/_Supporting/bases-contract-NPM/src/names.ts', major: 2, sha256: hash(source), update: 'node scripts/filename-contract.mjs --update'}, null, 2) + '\n');
} else {
  const owner = JSON.parse(await readFile(metadata, 'utf8'));
  if (hash(await readFile(generated)) !== owner.sha256) throw new Error('Filename compatibility copy changed. Regenerate from its canonical owner.');
  try {
    if (hash(await readFile(canonical)) !== owner.sha256) throw new Error('Canonical filename helper changed. Run the scoped update command after validating it.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
