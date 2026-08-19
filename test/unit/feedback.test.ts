import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLocalOracle, encode, isSolved, patternKey, score } from '../../src/feedback.ts';

/** Live /word pairs. Last column in PLAN is standard Wordle — we must not match that. */
const LIVE_PAIRS: ReadonlyArray<{ target: string; guess: string; expected: string }> = [
  { target: 'apple', guess: 'apple', expected: 'ccccc' },
  { target: 'apple', guess: 'zzzzz', expected: 'aaaaa' },
  { target: 'apple', guess: 'arise', expected: 'caaac' },
  { target: 'apple', guess: 'allee', expected: 'cpppc' },
  { target: 'apple', guess: 'eeeee', expected: 'ppppc' },
  { target: 'apple', guess: 'pppaa', expected: 'pccpp' },
  { target: 'apple', guess: 'pzzzp', expected: 'paaap' },
  { target: 'tests', guess: 'tooot', expected: 'caaap' },
  { target: 'tests', guess: 'ttttt', expected: 'cppcp' },
  { target: 'teyyy', guess: 'ttttt', expected: 'cpppp' },
];

describe('score (Votee per-slot, not Wordle)', () => {
  for (const { target, guess, expected } of LIVE_PAIRS) {
    it(`${guess} vs ${target} → ${expected}`, () => {
      const feedback = score(guess, target);
      assert.equal(encode(feedback), expected);
      assert.equal(patternKey(guess, target), expected);
    });
  }

  it('apple / allee is cpppc, not Wordle capac', () => {
    assert.equal(encode(score('allee', 'apple')), 'cpppc');
    assert.notEqual(encode(score('allee', 'apple')), 'capac');
  });

  it('isSolved is true only when every slot is correct', () => {
    assert.equal(isSolved(score('apple', 'apple')), true);
    assert.equal(isSolved(score('allee', 'apple')), false);
  });

  it('throws on length mismatch', () => {
    assert.throws(() => score('app', 'apple'), /length mismatch/);
  });

  it('createLocalOracle mirrors score', async () => {
    const oracle = createLocalOracle('apple');
    assert.deepEqual(await oracle('allee'), score('allee', 'apple'));
  });
});
