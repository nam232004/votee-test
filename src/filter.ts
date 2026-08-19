import { encode, patternKey } from './feedback.ts';
import type { Feedback } from './types.ts';

/** Keep iff this candidate, as secret, would produce the same encoded pattern. */
export function isConsistent(candidate: string, guess: string, feedback: Feedback): boolean {
  return patternKey(guess, candidate) === encode(feedback);
}

export function filterCandidates(candidates: string[], guess: string, feedback: Feedback): string[] {
  const expected = encode(feedback);
  return candidates.filter((candidate) => patternKey(guess, candidate) === expected);
}
