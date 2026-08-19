import { isSolved } from './feedback.ts';
import type { Feedback, Oracle, SolveStep } from './types.ts';

const ALPHA = 'abcdefghijklmnopqrstuvwxyz';
const MAX_PROBES = 40;

export type ProbeSlots = {
  fixed: (string | null)[];
  absent: Set<string>;
  bannedAt: Set<string>[];
  floating: Set<string>;
};

export type ProbeOptions = {
  oracle: Oracle;
  size: number;
  history: SolveStep[];
  onProgress?: (step: SolveStep) => void;
};

export function createSlots(size: number): ProbeSlots {
  return {
    fixed: Array.from({ length: size }, () => null),
    absent: new Set(),
    bannedAt: Array.from({ length: size }, () => new Set()),
    floating: new Set(),
  };
}

/** If a floating letter has only one legal slot, place it — no extra guess. */
export function deduce(slots: ProbeSlots): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const letter of [...slots.floating]) {
      const homes: number[] = [];
      for (let i = 0; i < slots.fixed.length; i++) {
        if (slots.fixed[i] === null && !slots.bannedAt[i]!.has(letter)) homes.push(i);
      }
      if (homes.length === 1) {
        slots.fixed[homes[0]!] = letter;
        slots.floating.delete(letter);
        changed = true;
      }
    }
  }
}

export function applyProbeFeedback(slots: ProbeSlots, guess: string, feedback: Feedback): void {
  for (let i = 0; i < guess.length; i++) {
    const letter = guess[i]!;
    const mark = feedback[i]!;
    if (mark === 'correct') {
      slots.fixed[i] = letter;
      slots.floating.delete(letter);
    } else if (mark === 'present') {
      slots.bannedAt[i]!.add(letter);
      if (!slots.fixed.includes(letter)) slots.floating.add(letter);
    } else {
      slots.absent.add(letter);
      slots.floating.delete(letter);
    }
  }
  deduce(slots);
}

function takeUnread(
  slots: ProbeSlots,
  tested: Set<string>,
  reserved: Set<string>,
  bannedAt?: Set<string>,
): string | undefined {
  for (const letter of ALPHA) {
    if (slots.absent.has(letter) || tested.has(letter) || reserved.has(letter)) continue;
    if (bannedAt?.has(letter)) continue;
    return letter;
  }
  return undefined;
}

function possibleAt(slots: ProbeSlots, index: number): string {
  const known = [
    ...slots.floating,
    ...slots.fixed.filter((letter): letter is string => letter !== null),
  ];
  for (const letter of [...known, ...ALPHA]) {
    if (slots.absent.has(letter) || slots.bannedAt[index]!.has(letter)) continue;
    return letter;
  }
  return 'a';
}

function assembled(slots: ProbeSlots): string | null {
  if (slots.fixed.some((letter) => letter === null)) return null;
  return slots.fixed.join('');
}

/** Distinct letters are preferred, not required — repeats like zzzzz / queue must still finish. */
export function buildProbeGuess(slots: ProbeSlots, tested: Set<string>): string {
  const done = assembled(slots);
  if (done !== null) return done;

  const size = slots.fixed.length;
  const out: string[] = Array.from({ length: size }, () => '');
  const reserved = new Set<string>();

  for (const letter of slots.floating) {
    for (let i = 0; i < size; i++) {
      if (slots.fixed[i] !== null || out[i] !== '') continue;
      if (slots.bannedAt[i]!.has(letter)) continue;
      out[i] = letter;
      reserved.add(letter);
      break;
    }
  }

  for (let i = 0; i < size; i++) {
    if (slots.fixed[i] !== null || out[i] !== '') continue;
    const unread = takeUnread(slots, tested, reserved, slots.bannedAt[i]);
    if (unread !== undefined) {
      out[i] = unread;
      reserved.add(unread);
    }
  }

  for (let i = 0; i < size; i++) {
    if (slots.fixed[i] === null) continue;
    const unread = takeUnread(slots, tested, reserved);
    if (unread !== undefined) {
      out[i] = unread;
      reserved.add(unread);
    } else {
      out[i] = slots.fixed[i]!;
    }
  }

  for (let i = 0; i < size; i++) {
    if (out[i] !== '') continue;
    out[i] = possibleAt(slots, i);
  }

  return out.join('');
}

export async function resolveByProbing(options: ProbeOptions): Promise<{
  answer: string | null;
  steps: SolveStep[];
}> {
  const { oracle, size, history, onProgress } = options;
  const slots = createSlots(size);
  const tested = new Set<string>();
  const steps: SolveStep[] = [];

  for (const step of history) {
    applyProbeFeedback(slots, step.guess, step.feedback);
    for (const letter of step.guess) tested.add(letter);
  }

  let attempt = history.length;
  for (let n = 0; n < MAX_PROBES; n++) {
    deduce(slots);
    const guess = buildProbeGuess(slots, tested);
    attempt += 1;
    const feedback = await oracle(guess);
    applyProbeFeedback(slots, guess, feedback);
    for (const letter of guess) tested.add(letter);

    const unresolvedSlots = slots.fixed.filter((letter) => letter === null).length;
    const step: SolveStep = {
      attempt,
      guess,
      feedback,
      remaining: 0,
      phase: 'probe',
      unresolvedSlots,
    };
    steps.push(step);
    onProgress?.(step);

    if (isSolved(feedback)) {
      return { answer: guess, steps };
    }
  }

  return { answer: assembled(slots), steps };
}
