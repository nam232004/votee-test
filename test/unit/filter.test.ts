import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { encode, score } from '../../src/feedback.ts';
import { filterCandidates, isConsistent } from '../../src/filter.ts';

/** Inline stand-in until words.ts exists. */
const WORDS = ['apple', 'allee', 'apply', 'ample', 'alley', 'arise', 'zzzzz', 'tests'];

describe('filterCandidates', () => {
  it('keeps the true target after apple + allee → cpppc', () => {
    const guess = 'allee';
    const feedback = score(guess, 'apple');
    assert.equal(encode(feedback), 'cpppc');

    const remaining = filterCandidates(WORDS, guess, feedback);
    assert.ok(remaining.includes('apple'));
    assert.equal(isConsistent('apple', guess, feedback), true);
  });

  it('drops any word that would not produce cpppc for guess allee', () => {
    const guess = 'allee';
    const feedback = score(guess, 'apple');
    const remaining = filterCandidates(WORDS, guess, feedback);

    for (const word of remaining) {
      assert.equal(encode(score(guess, word)), 'cpppc', `${word} survived but would not score cpppc`);
    }
    for (const word of WORDS) {
      if (encode(score(guess, word)) !== 'cpppc') {
        assert.equal(remaining.includes(word), false, `${word} should have been dropped`);
      }
    }
    assert.equal(remaining.includes('allee'), false);
    assert.equal(remaining.includes('apply'), false);
    assert.equal(remaining.includes('zzzzz'), false);
  });

  it('all-correct feedback leaves only the secret', () => {
    const remaining = filterCandidates(WORDS, 'apple', score('apple', 'apple'));
    assert.deepEqual(remaining, ['apple']);
  });

  it('absent letter (zzzzz vs apple) drops words that contain that letter', () => {
    const remaining = filterCandidates(WORDS, 'zzzzz', score('zzzzz', 'apple'));
    assert.ok(remaining.includes('apple'));
    assert.equal(remaining.includes('zzzzz'), false);
  });
});
