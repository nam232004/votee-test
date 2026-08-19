import { readFile } from 'node:fs/promises';
import path from 'node:path';

const dataDir = path.join(import.meta.dirname, '..', 'data');

export async function loadWords(size = 5): Promise<string[]> {
  const file = path.join(dataDir, `words${size}.txt`);
  const text = await readFile(file, 'utf8');
  return text.split(/\r?\n/).filter((word) => word.length === size);
}

export async function loadOpening(): Promise<string | undefined> {
  try {
    const raw = await readFile(path.join(dataDir, 'opening.json'), 'utf8');
    const parsed = JSON.parse(raw) as { word?: string };
    return parsed.word;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return undefined;
    throw err;
  }
}
