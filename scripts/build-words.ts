import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import wordListPath from 'word-list';

const text = await readFile(wordListPath, 'utf8');
const words = [
  ...new Set(
    text
      .split(/\r?\n/)
      .map((word) => word.trim().toLowerCase())
      .filter((word) => /^[a-z]{5}$/.test(word)),
  ),
].sort();

if (words.length < 10_000 || words.length > 20_000) {
  throw new Error(`expected 10000–20000 five-letter words, got ${words.length}`);
}

for (const required of ['fiery', 'wrote', 'poise', 'vetch']) {
  if (!words.includes(required)) {
    throw new Error(`dictionary missing required word "${required}"`);
  }
}

const out = path.join(import.meta.dirname, '..', 'data', 'words5.txt');
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, `${words.join('\n')}\n`);
console.log(`Wrote ${words.length} words to ${out}`);
