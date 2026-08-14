import type { Feedback, Mark, Oracle } from './types.ts';

/**
 * Luật tính điểm của API Votee, đã kiểm chứng bằng 10 case thật (xem README).
 *
 * Mỗi ô được đánh giá ĐỘC LẬP. Đây KHÔNG phải luật Wordle chuẩn: Wordle phân bổ theo số
 * lần xuất hiện, nên `apple` + `allee` cho `c a p a c`, còn API này cho `c p p p c`.
 *
 * Hệ quả: `absent` nghĩa là chữ đó không có ở bất kỳ đâu, và `present` không mang thông
 * tin gì về số lượng.
 */
export function score(guess: string, target: string): Feedback {
  if (guess.length !== target.length) {
    throw new Error(`score(): độ dài lệch — guess "${guess}" (${guess.length}) vs target "${target}" (${target.length})`);
  }

  const marks: Mark[] = new Array(guess.length);
  for (let i = 0; i < guess.length; i++) {
    const letter = guess[i]!;
    if (letter === target[i]) marks[i] = 'correct';
    else if (target.includes(letter)) marks[i] = 'present';
    else marks[i] = 'absent';
  }
  return marks;
}

/**
 * Cùng luật với `score` nhưng trả về string ngắn ('cpppc') thay vì array.
 * Đây là hot path của minimax: dùng làm key phân hoạch mà không cấp phát array.
 */
export function patternKey(guess: string, target: string): string {
  let key = '';
  for (let i = 0; i < guess.length; i++) {
    const letter = guess[i]!;
    if (letter === target[i]) key += 'c';
    else if (target.includes(letter)) key += 'p';
    else key += 'a';
  }
  return key;
}

export function isSolved(feedback: Feedback): boolean {
  return feedback.every((mark) => mark === 'correct');
}

export function encode(feedback: Feedback): string {
  return feedback.map((mark) => mark[0]).join('');
}

/**
 * Oracle chạy hoàn toàn offline, dùng cho benchmark và test. Tương đương /word/{target}
 * nhưng không cần mạng — có test đối chiếu với API thật trong test/live/api.test.ts.
 */
export function createLocalOracle(target: string): Oracle {
  return async (guess) => score(guess, target);
}
