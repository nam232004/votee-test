import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = join(import.meta.dirname, '..', 'data');

/**
 * Danh sách từ ứng viên. Từ bí mật của API lấy từ từ điển tiếng Anh đầy đủ, không phải
 * danh sách 2.315 đáp án Wordle chính thức — đã xác nhận bằng `vetch`, một từ chỉ hợp lệ
 * để đoán chứ không nằm trong danh sách đáp án.
 */
export function loadWords(size = 5): string[] {
  if (size !== 5) {
    throw new Error(
      `loadWords(): chỉ có từ điển size 5 (data/words5.txt). Sinh thêm bằng \`npm run build:words\`.`,
    );
  }

  const words = readFileSync(join(DATA_DIR, `words${size}.txt`), 'utf8')
    .split('\n')
    .map((line) => line.trim().toLowerCase())
    .filter((word) => word.length === size && /^[a-z]+$/.test(word));

  if (words.length === 0) {
    throw new Error('loadWords(): từ điển rỗng — chạy `npm run build:words`');
  }
  return [...new Set(words)].sort();
}

/**
 * Từ mở đầu tối ưu, do `scripts/best-opening.ts` tính bằng entropy trên toàn từ điển —
 * không hardcode. Cache lại vì lượt 1 luôn có cùng candidate set nên kết quả không đổi.
 * Thiếu file thì trả undefined và solver tự tính bằng heuristic.
 */
export function loadOpening(): string | undefined {
  try {
    const { word } = JSON.parse(readFileSync(join(DATA_DIR, 'opening.json'), 'utf8')) as { word: string };
    return word;
  } catch {
    return undefined;
  }
}
