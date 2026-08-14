/**
 * Tính từ mở đầu tối ưu bằng entropy trên TOÀN từ điển, rồi ghi ra data/opening.json.
 *
 * Chỉ chạy lúc dev vì tốn ~12.578² lần đánh giá. Solver đọc file kết quả nên lượt 1 không
 * phải tính lại. Đây là lý do opening word không bị hardcode: nó được TÍNH ra từ chính từ
 * điển và chính luật scoring của API này.
 *
 * Pattern được mã hoá thành số base-3 (absent=0, present=1, correct=2) để đếm bằng typed
 * array, tránh cấp phát 158 triệu string.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadWords } from '../src/words.ts';

const SIZE = 5;
const PATTERNS = 3 ** SIZE;

const words = loadWords(SIZE);
const total = words.length;

// Phẳng hoá thành mã ký tự để vòng lặp trong không phải truy cập string.
const letters = new Uint8Array(total * SIZE);
for (let w = 0; w < total; w++) {
  const word = words[w]!;
  for (let i = 0; i < SIZE; i++) letters[w * SIZE + i] = word.charCodeAt(i);
}

// Bitmask 26 bit: chữ nào có mặt trong từ. Thay cho target.includes() ở vòng trong.
const masks = new Int32Array(total);
for (let w = 0; w < total; w++) {
  let mask = 0;
  for (let i = 0; i < SIZE; i++) mask |= 1 << (letters[w * SIZE + i]! - 97);
  masks[w] = mask;
}

const counts = new Int32Array(PATTERNS);
const logTotal = Math.log2(total);

let bestWord = '';
let bestBits = -Infinity;
const ranking: { word: string; bits: number }[] = [];
const started = Date.now();

for (let g = 0; g < total; g++) {
  counts.fill(0);
  const base = g * SIZE;

  for (let t = 0; t < total; t++) {
    const targetBase = t * SIZE;
    const mask = masks[t]!;
    let code = 0;
    for (let i = 0; i < SIZE; i++) {
      const letter = letters[base + i]!;
      const mark = letter === letters[targetBase + i] ? 2 : (mask >> (letter - 97)) & 1;
      code = code * 3 + mark;
    }
    counts[code]!++;
  }

  // H = Σ -p·log2(p), viết lại theo count để tránh chia trong vòng lặp.
  let bits = 0;
  for (let code = 0; code < PATTERNS; code++) {
    const n = counts[code]!;
    if (n > 0) bits -= n * (Math.log2(n) - logTotal);
  }
  bits /= total;

  ranking.push({ word: words[g]!, bits });
  if (bits > bestBits || (bits === bestBits && words[g]! < bestWord)) {
    bestBits = bits;
    bestWord = words[g]!;
  }

  if (g % 1000 === 0) {
    process.stdout.write(`\r${g}/${total}  best=${bestWord} (${bestBits.toFixed(4)} bits)   `);
  }
}

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
ranking.sort((a, b) => b.bits - a.bits || a.word.localeCompare(b.word));

console.log(`\n\nTop 10 opening (entropy trên ${total.toLocaleString('en-US')} từ, ${elapsed}s):`);
for (const { word, bits } of ranking.slice(0, 10)) {
  console.log(`  ${word}  ${bits.toFixed(4)} bits`);
}

writeFileSync(
  join(import.meta.dirname, '..', 'data', 'opening.json'),
  JSON.stringify({ word: bestWord, bits: Number(bestBits.toFixed(4)), dictionarySize: total }, null, 2) + '\n',
);
console.log(`\ndata/opening.json → "${bestWord}"`);
