import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  entropyBits,
  partitionSizes,
  pickGuess,
  scoreByFrequency,
  worstCase,
} from '../../src/strategy.ts';
import { mulberry32, shuffle } from './helpers.ts';

const TINY = ['apple', 'apply', 'ample', 'allee', 'arise'];

describe('pickGuess', () => {
  it('returns the only remaining candidate', () => {
    assert.equal(pickGuess(['apple']), 'apple');
  });

  it('is deterministic across shuffled input order', () => {
    const rand = mulberry32(1);
    const a = pickGuess(shuffle(TINY, rand), { strategy: 'freq' });
    const b = pickGuess(shuffle(TINY, rand), { strategy: 'freq' });
    const c = pickGuess(shuffle(TINY, rand), { strategy: 'entropy' });
    const d = pickGuess(shuffle(TINY, rand), { strategy: 'entropy' });
    assert.equal(a, b);
    assert.equal(c, d);
    assert.equal(pickGuess([...TINY].reverse(), { strategy: 'minimax' }), pickGuess(TINY, { strategy: 'minimax' }));
  });

  it('freq penalizes repeated letters', () => {
    const candidates = ['abcde', 'aaaaa', 'ababa'];
    const scores = scoreByFrequency(candidates);
    assert.ok(scores.get('abcde')! > scores.get('aaaaa')!);
    assert.ok(scores.get('abcde')! > scores.get('ababa')!);
    assert.equal(pickGuess(candidates, { strategy: 'freq' }), 'abcde');
  });

  it('defaults to freq', () => {
    assert.equal(pickGuess(TINY), pickGuess(TINY, { strategy: 'freq' }));
  });
});

describe('named partition helpers', () => {
  it('partitionSizes groups by pattern', () => {
    const sizes = partitionSizes('allee', ['apple', 'allee']);
    assert.equal(sizes.reduce((a, b) => a + b, 0), 2);
    assert.equal(sizes.length, 2);
  });

  it('entropyBits is higher for an even split than a single bucket', () => {
    assert.ok(entropyBits([1, 1], 2) > entropyBits([2], 2));
  });

  it('worstCase is Math.max of bucket sizes', () => {
    assert.equal(worstCase([1, 8, 3]), 8);
  });

  it('minimax uses worstCase(partitionSizes(...)) and picks the smaller worst bucket', () => {
    const candidates = ['hazed', 'fazed', 'gazed'];
    const guess = pickGuess(candidates, { strategy: 'minimax' });
    const worst = worstCase(partitionSizes(guess, candidates));
    for (const other of candidates) {
      assert.ok(worst <= worstCase(partitionSizes(other, candidates)));
    }
  });
});
