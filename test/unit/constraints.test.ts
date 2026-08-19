import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createKnowledge, satisfies, updateKnowledge } from '../../src/constraints.ts';
import { score } from '../../src/feedback.ts';
import { filterCandidates } from '../../src/filter.ts';
import { mulberry32 } from './helpers.ts';

const WORDS = ['apple', 'apply', 'ample', 'allee', 'arise', 'tares', 'tests', 'fiery'];

describe('constraints (display model, not a second filter)', () => {
  it('matches filterCandidates on many (target, guess) pairs', () => {
    const rand = mulberry32(42);
    for (let n = 0; n < 200; n++) {
      const target = WORDS[Math.floor(rand() * WORDS.length)]!;
      const guess = WORDS[Math.floor(rand() * WORDS.length)]!;
      const feedback = score(guess, target);
      const byPattern = new Set(filterCandidates(WORDS, guess, feedback));
      const knowledge = createKnowledge(guess.length);
      updateKnowledge(knowledge, guess, feedback);
      const byConstraints = new Set(WORDS.filter((word) => satisfies(word, knowledge)));
      assert.deepEqual([...byConstraints].sort(), [...byPattern].sort());
    }
  });
});
