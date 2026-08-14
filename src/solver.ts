import { isSolved } from './feedback.ts';
import { filterCandidates } from './filter.ts';
import { pickGuess, type StrategyName } from './strategy.ts';
import type { Oracle, SolveResult, SolveStep } from './types.ts';

/** Candidate set rỗng ⇒ từ bí mật không nằm trong từ điển. Fail rõ ràng, không đoán bừa. */
export class DictionaryGapError extends Error {
  constructor(attempt: number, history: SolveStep[]) {
    const guesses = history.map((step) => step.guess).join(', ');
    super(
      `Không còn candidate nào sau lượt ${attempt} (đã đoán: ${guesses}). ` +
        `Từ bí mật không nằm trong từ điển, hoặc luật scoring đã thay đổi.`,
    );
    this.name = 'DictionaryGapError';
  }
}

export type SolveOptions = {
  oracle: Oracle;
  words: string[];
  maxAttempts?: number;
  strategy?: StrategyName;
  /** Số candidate tối đa còn cho phép phân hoạch; trên ngưỡng thì về heuristic tần suất. */
  maxPartitionCandidates?: number;
  /** Guess lượt 1 đã tính trước. Lượt 1 luôn cùng candidate set nên tính lại là vô nghĩa. */
  firstGuess?: string;
  onProgress?: (step: SolveStep) => void;
};

/**
 * Vòng lặp giải, không biết nó đang chơi với endpoint nào — chỉ nhận một `oracle`. Nhờ vậy
 * cùng một thuật toán chạy được cho test có đáp án (/word) và puzzle ẩn (/random, /daily).
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
  onProgress,
}: SolveOptions): Promise<SolveResult> {
  let candidates = words;
  const history: SolveStep[] = [];

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
      const step: SolveStep = { attempt, guess, feedback, remaining: 1 };
      history.push(step);
      onProgress?.(step);
      return { solved: true, answer: guess, attempts: attempt, history };
    }

    candidates = filterCandidates(candidates, guess, feedback);
    const step: SolveStep = { attempt, guess, feedback, remaining: candidates.length };
    history.push(step);
    onProgress?.(step);

    if (candidates.length === 0) throw new DictionaryGapError(attempt, history);
  }

  return { solved: false, answer: null, attempts: maxAttempts, history };
}
