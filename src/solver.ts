import { isSolved } from './feedback.ts';
import { filterCandidates } from './filter.ts';
import { resolveByProbing } from './probe.ts';
import { pickGuess, type GuessStrategy } from './strategy.ts';
import type { Oracle, SolveResult, SolveStep } from './types.ts';

export type SolveOptions = {
  oracle: Oracle;
  words: string[];
  strategy?: GuessStrategy;
  firstGuess?: string;
  fallback?: boolean;
  maxAttempts?: number;
  onProgress?: (step: SolveStep) => void;
};

export class DictionaryGapError extends Error {
  readonly attempt: number;
  readonly history: SolveStep[];

  constructor(attempt: number, history: SolveStep[]) {
    super(`No dictionary candidates left after attempt ${attempt}`);
    this.name = 'DictionaryGapError';
    this.attempt = attempt;
    this.history = history;
  }
}

export async function solve(options: SolveOptions): Promise<SolveResult> {
  const {
    oracle,
    words,
    strategy = 'entropy',
    firstGuess,
    fallback = true,
    maxAttempts = 6,
    onProgress,
  } = options;

  let candidates = words.slice();
  const history: SolveStep[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptsLeft = maxAttempts - attempt + 1;
    const guess =
      attempt === 1 && firstGuess !== undefined
        ? firstGuess
        : pickGuess(candidates, { strategy, dictionary: words, attemptsLeft });

    const feedback = await oracle(guess);
    candidates = filterCandidates(candidates, guess, feedback);

    const step: SolveStep = {
      attempt,
      guess,
      feedback,
      remaining: candidates.length,
      phase: 'inference',
    };
    history.push(step);
    onProgress?.(step);

    if (isSolved(feedback)) {
      return { solved: true, answer: guess, attempts: history.length, history };
    }

    if (candidates.length === 0) {
      if (!fallback) throw new DictionaryGapError(attempt, history);
      break;
    }
  }

  if (!fallback) {
    return { solved: false, answer: null, attempts: history.length, history };
  }

  const size = words[0]?.length ?? history[0]?.guess.length ?? 5;
  const { answer, steps } = await resolveByProbing({ oracle, size, history, onProgress });
  history.push(...steps);
  const last = history.at(-1);
  if (answer !== null && last !== undefined && isSolved(last.feedback)) {
    return { solved: true, answer, attempts: history.length, history };
  }
  return { solved: false, answer, attempts: history.length, history };
}
