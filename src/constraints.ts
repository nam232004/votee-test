import type { Feedback } from './types.ts';

export type Knowledge = {
  fixed: (string | null)[];
  required: Set<string>;
  forbidden: Set<string>;
  bannedAt: Set<string>[];
};

export function createKnowledge(size: number): Knowledge {
  return {
    fixed: Array.from({ length: size }, () => null),
    required: new Set(),
    forbidden: new Set(),
    bannedAt: Array.from({ length: size }, () => new Set()),
  };
}

export function updateKnowledge(knowledge: Knowledge, guess: string, feedback: Feedback): void {
  for (let i = 0; i < feedback.length; i++) {
    const letter = guess[i]!;
    const mark = feedback[i]!;
    if (mark === 'correct') {
      knowledge.fixed[i] = letter;
      knowledge.required.add(letter);
    } else if (mark === 'present') {
      knowledge.required.add(letter);
      knowledge.bannedAt[i]!.add(letter);
    } else {
      knowledge.forbidden.add(letter);
    }
  }
}

/** Display only — solver still filters via filterCandidates. */
export function describe(knowledge: Knowledge): string {
  const known = knowledge.fixed.map((ch) => ch ?? '_').join(' ');
  const must = [...knowledge.required].sort().join(', ') || '—';
  const ruledOut = [...knowledge.forbidden].sort().join(', ') || '—';
  const notAt: string[] = [];
  for (let i = 0; i < knowledge.bannedAt.length; i++) {
    for (const letter of [...knowledge.bannedAt[i]!].sort()) {
      notAt.push(`${letter}@${i}`);
    }
  }
  return `known: ${known}   must have: ${must}   ruled out: ${ruledOut}   not at: ${notAt.join(', ') || '—'}`;
}

export function satisfies(candidate: string, knowledge: Knowledge): boolean {
  for (let i = 0; i < candidate.length; i++) {
    const letter = candidate[i]!;
    const fixed = knowledge.fixed[i];
    if (fixed !== null && letter !== fixed) return false;
    if (knowledge.bannedAt[i]?.has(letter)) return false;
    if (knowledge.forbidden.has(letter)) return false;
  }
  for (const letter of knowledge.required) {
    if (!candidate.includes(letter)) return false;
  }
  return true;
}
