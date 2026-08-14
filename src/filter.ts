import { patternKey, encode } from './feedback.ts';
import type { Feedback } from './types.ts';

/**
 * Suy luận ngược: nếu `candidate` là từ bí mật thật, server đã phải trả về
 * score(guess, candidate). Server trả về `feedback`. Vậy candidate còn khả thi khi và chỉ
 * khi hai thứ đó bằng nhau.
 *
 * Cách này đúng chính xác vì `score` là bản mirror của luật server, và nó không thể lệch
 * khỏi server theo thời gian như một bộ luật viết tay.
 */
export function isConsistent(candidate: string, guess: string, feedback: Feedback): boolean {
  return patternKey(guess, candidate) === encode(feedback);
}

export function filterCandidates(candidates: string[], guess: string, feedback: Feedback): string[] {
  const expected = encode(feedback);
  return candidates.filter((candidate) => patternKey(guess, candidate) === expected);
}
