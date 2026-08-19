import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLocalOracle } from '../../src/feedback.ts';
import { DictionaryGapError, solve } from '../../src/solver.ts';
import { loadOpening, loadWords } from '../../src/words.ts';

describe('solve', () => {
  it('solves apple with the local oracle', async () => {
    const words = await loadWords(5);
    const firstGuess = (await loadOpening()) ?? 'tares';
    const result = await solve({
      oracle: createLocalOracle('apple'),
      words,
      firstGuess,
    });
    assert.equal(result.solved, true);
    assert.equal(result.answer, 'apple');
    assert.ok(result.attempts >= 1 && result.attempts <= 6);
    assert.equal(result.history.at(-1)?.guess, 'apple');
  });

  it('throws DictionaryGapError when the secret is missing and fallback is off', async () => {
    await assert.rejects(
      () =>
        solve({
          oracle: createLocalOracle('qqqqq'),
          words: ['apple', 'arise', 'tares'],
          firstGuess: 'tares',
          fallback: false,
          maxAttempts: 6,
        }),
      (err: unknown) => {
        assert.ok(err instanceof DictionaryGapError);
        assert.equal(err.name, 'DictionaryGapError');
        return true;
      },
    );
  });

  it('probes and solves when the secret is missing and fallback is on', async () => {
    const result = await solve({
      oracle: createLocalOracle('qqqqq'),
      words: ['apple', 'arise', 'tares'],
      firstGuess: 'tares',
      fallback: true,
    });
    assert.equal(result.solved, true);
    assert.equal(result.answer, 'qqqqq');
    assert.ok(result.history.some((step) => step.phase === 'probe'));
  });
});
