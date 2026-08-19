import { patternKey } from './feedback.ts';

export type GuessStrategy = 'freq' | 'entropy' | 'minimax';

export type PickGuessOptions = {
  strategy?: GuessStrategy;
  dictionary?: string[];
  attemptsLeft?: number;
  maxPartition?: number;
};

const DEFAULT_MAX_PARTITION = 300;
const WIDEN_AT = 30;

/** Bucket sizes: same patternKey ⇒ same bucket. */
export function partitionSizes(guess: string, candidates: string[]): number[] {
  const buckets = new Map<string, number>();
  for (const candidate of candidates) {
    const key = patternKey(guess, candidate);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.values()];
}

/** Shannon entropy in bits. Maximize. */
export function entropyBits(sizes: number[], total: number): number {
  let bits = 0;
  for (const size of sizes) {
    if (size === 0 || total === 0) continue;
    const p = size / total;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** Largest bucket. Minimax minimizes this (Knuth 1976). */
export function worstCase(sizes: number[]): number {
  return Math.max(...sizes);
}

function slotCounts(words: string[], size: number): Array<Map<string, number>> {
  const counts = Array.from({ length: size }, () => new Map<string, number>());
  for (const word of words) {
    for (let i = 0; i < size; i++) {
      const letter = word[i]!;
      const slot = counts[i]!;
      slot.set(letter, (slot.get(letter) ?? 0) + 1);
    }
  }
  return counts;
}

function frequencyScore(word: string, counts: Array<Map<string, number>>, size: number): number {
  let score = 0;
  for (let i = 0; i < size; i++) {
    score += counts[i]!.get(word[i]!) ?? 0;
  }
  const duplicates = size - new Set(word).size;
  return score * 0.5 ** duplicates;
}

/** Sum of per-slot letter counts among `candidates`. Repeats: score * 0.5**duplicates. Not product-of-gaps. */
export function scoreByFrequency(candidates: string[]): Map<string, number> {
  if (candidates.length === 0) return new Map();
  const size = candidates[0]!.length;
  const counts = slotCounts(candidates, size);
  const scores = new Map<string, number>();
  for (const word of candidates) {
    scores.set(word, frequencyScore(word, counts, size));
  }
  return scores;
}

function pickBest(
  pool: string[],
  metric: Map<string, number>,
  inCandidates: Set<string>,
  maximize: boolean,
): string {
  let best = pool[0]!;
  let bestScore = metric.get(best) ?? 0;
  let bestIn = inCandidates.has(best);

  for (let i = 1; i < pool.length; i++) {
    const word = pool[i]!;
    const score = metric.get(word) ?? 0;
    const inSet = inCandidates.has(word);
    const better = maximize ? score > bestScore : score < bestScore;
    const worse = maximize ? score < bestScore : score > bestScore;
    if (better) {
      best = word;
      bestScore = score;
      bestIn = inSet;
      continue;
    }
    if (worse) continue;
    if (inSet && !bestIn) {
      best = word;
      bestIn = true;
      continue;
    }
    if (inSet === bestIn && word < best) best = word;
  }
  return best;
}

/**
 * Default strategy is freq. `|C| > 300` always uses freq.
 * `|C| ≤ 30` and attemptsLeft > 1 may guess from the full dictionary.
 */
export function pickGuess(candidates: string[], options: PickGuessOptions = {}): string {
  if (candidates.length === 0) {
    throw new Error('pickGuess(): empty candidate list');
  }
  if (candidates.length === 1) return candidates[0]!;

  const strategy = options.strategy ?? 'freq';
  const tooExpensive = candidates.length > (options.maxPartition ?? DEFAULT_MAX_PARTITION);
  const canWiden =
    options.dictionary !== undefined &&
    candidates.length <= WIDEN_AT &&
    (options.attemptsLeft ?? 0) > 1;
  const pool = canWiden ? options.dictionary! : candidates;
  const inCandidates = new Set(candidates);

  if (strategy === 'freq' || tooExpensive) {
    const size = candidates[0]!.length;
    const counts = slotCounts(candidates, size);
    const metric = new Map<string, number>();
    for (const word of pool) {
      metric.set(word, frequencyScore(word, counts, size));
    }
    return pickBest(pool, metric, inCandidates, true);
  }

  const total = candidates.length;
  const metric = new Map<string, number>();
  if (strategy === 'minimax') {
    for (const guess of pool) {
      metric.set(guess, worstCase(partitionSizes(guess, candidates)));
    }
    return pickBest(pool, metric, inCandidates, false);
  }

  for (const guess of pool) {
    metric.set(guess, entropyBits(partitionSizes(guess, candidates), total));
  }
  return pickBest(pool, metric, inCandidates, true);
}
