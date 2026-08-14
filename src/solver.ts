import { isSolved } from './feedback.ts';
import { filterCandidates } from './filter.ts';
import { resolveByProbing } from './probe.ts';
import { pickGuess, type StrategyName } from './strategy.ts';
import type { Oracle, SolveResult, SolveStep } from './types.ts';

/**
 * Suy luận theo từ điển đã bế tắc mà phần dò dự phòng bị tắt.
 *
 * Bật `fallback` (mặc định) thì lỗi này không xảy ra: solver chuyển sang dò từng ô và luôn
 * tìm ra từ. Chỉ benchmark tắt fallback, để đo riêng chất lượng của phần suy luận.
 */
export class DictionaryGapError extends Error {
  constructor(attempt: number, history: SolveStep[]) {
    const guesses = history.map((step) => step.guess).join(', ');
    super(
      `Không còn candidate nào sau lượt ${attempt} (đã đoán: ${guesses}). ` +
        `Từ bí mật không nằm trong từ điển và fallback đang bị tắt.`,
    );
    this.name = 'DictionaryGapError';
  }
}

export type SolveOptions = {
  oracle: Oracle;
  words: string[];
  /** Số lượt dành cho suy luận theo từ điển. Hết thì chuyển sang dò. */
  maxAttempts?: number;
  strategy?: StrategyName;
  maxPartitionCandidates?: number;
  firstGuess?: string;
  /** Dò từng ô khi suy luận bế tắc. Tắt chỉ để benchmark phần suy luận. */
  fallback?: boolean;
  onProgress?: (step: SolveStep) => void;
};

/**
 * Vòng lặp giải, không biết nó đang chơi với endpoint nào — chỉ nhận một `oracle`. Nhờ vậy
 * cùng một thuật toán chạy được cho test có đáp án (/word) và puzzle ẩn (/random, /daily).
 *
 * Hai giai đoạn. Suy luận theo từ điển giải xong trong ~4 lượt cho đa số từ. Nếu từ bí mật
 * không có trong từ điển — API có dùng danh từ riêng và dạng viết tắt — thì chuyển sang dò
 * từng ô, chậm hơn nhưng bảo đảm tìm ra. Mục tiêu là tìm được từ, không phải bảo vệ từ điển.
 *
 * Không tự in gì; ai muốn hiển thị thì truyền `onProgress`.
 */
export async function solve({
  oracle,
  words,
  maxAttempts = 6,
  strategy = 'entropy',
  maxPartitionCandidates,
  firstGuess,
  fallback = true,
  onProgress,
}: SolveOptions): Promise<SolveResult> {
  let candidates = words;
  const history: SolveStep[] = [];
  const size = words[0]!.length;

  const finish = (guess: string, attempt: number): SolveResult => ({
    solved: true,
    answer: guess,
    attempts: attempt,
    history,
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const guess =
      attempt === 1 && firstGuess !== undefined
        ? firstGuess
        : pickGuess(candidates, {
            strategy,
            dictionary: words,
            attemptsLeft: maxAttempts - attempt + 1,
            maxPartitionCandidates,
          });
    const feedback = await oracle(guess);

    if (isSolved(feedback)) {
      const step: SolveStep = { attempt, guess, feedback, remaining: 1, phase: 'inference' };
      history.push(step);
      onProgress?.(step);
      return finish(guess, attempt);
    }

    candidates = filterCandidates(candidates, guess, feedback);
    const step: SolveStep = { attempt, guess, feedback, remaining: candidates.length, phase: 'inference' };
    history.push(step);
    onProgress?.(step);

    if (candidates.length === 0) {
      if (!fallback) throw new DictionaryGapError(attempt, history);
      break;
    }
  }

  if (!fallback) return { solved: false, answer: null, attempts: history.length, history };

  const { answer, steps } = await resolveByProbing({ oracle, size, history, onProgress });
  history.push(...steps);
  return finish(answer, history.length);
}
