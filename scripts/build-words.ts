/**
 * Sinh data/words5.txt từ package `word-list` (MIT, dữ liệu từ SCOWL).
 *
 * Chỉ chạy lúc dev. File kết quả được commit, nên chạy solver không cần dependency nào.
 * Xem mục attribution trong README.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import wordListPath from 'word-list';

const SIZE = 5;
/** Từ bí mật đã biết chắc, dùng để chứng minh từ điển đủ phủ. */
const MUST_CONTAIN = ['fiery', 'wrote', 'poise', 'vetch'];

const words = readFileSync(wordListPath, 'utf8')
  .split('\n')
  .map((word) => word.trim().toLowerCase())
  .filter((word) => word.length === SIZE && /^[a-z]+$/.test(word));

const unique = [...new Set(words)].sort();

const missing = MUST_CONTAIN.filter((word) => !unique.includes(word));
if (missing.length > 0) {
  throw new Error(`Từ điển thiếu từ đã biết chắc là đáp án: ${missing.join(', ')} — cần đổi nguồn`);
}
if (unique.length < 10_000 || unique.length > 20_000) {
  throw new Error(`Từ điển có ${unique.length} từ, ngoài khoảng kỳ vọng 10.000–20.000`);
}

const dataDir = join(import.meta.dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });
writeFileSync(join(dataDir, `words${SIZE}.txt`), unique.join('\n') + '\n');

console.log(`data/words${SIZE}.txt — ${unique.length.toLocaleString('en-US')} từ`);
