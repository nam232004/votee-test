import type { Feedback, Mark, Oracle } from './types.ts';

/** Per-slot Votee scoring — not Wordle's duplicate allocator. */
export function score(guess: string, target: string): Feedback {
  if (guess.length !== target.length) {
    throw new Error(`score(): length mismatch — "${guess}" vs "${target}"`);
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

export function encode(feedback: Feedback): string {
  return feedback.map((mark) => mark[0]).join('');
}

export function isSolved(feedback: Feedback): boolean {
  return feedback.every((mark) => mark === 'correct');
}

export function createLocalOracle(target: string): Oracle {
  return async (guess) => score(guess, target);
}
