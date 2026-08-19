import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BASE_URL, createRandomOracle, createWordOracle, toFeedback } from '../../src/api.ts';
import { encode, score } from '../../src/feedback.ts';
import { solve } from '../../src/solver.ts';
import { loadOpening, loadWords } from '../../src/words.ts';

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

describe('live Votee API contract', () => {
  for (const { target, guess, expected } of LIVE_PAIRS) {
    it(`local score matches /word/${target}?guess=${guess} → ${expected}`, async () => {
      const local = encode(score(guess, target));
      const live = encode(await createWordOracle(target)(guess));
      assert.equal(local, expected);
      assert.equal(live, expected);
    });
  }

  it('apple / allee is cpppc on the live API', async () => {
    assert.equal(encode(await createWordOracle('apple')('allee')), 'cpppc');
  });
});

describe('live /random', () => {
  it('seed=1 twice is identical', async () => {
    const a = encode(await createRandomOracle(1)('arise'));
    const b = encode(await createRandomOracle(1)('arise'));
    assert.equal(a, b);
  });

  it('without seed, several fetches see more than one secret', async () => {
    const keys = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const res = await fetch(`${BASE_URL}/random?size=5&guess=arise`);
      assert.equal(res.ok, true, await res.text());
      const json = (await res.json()) as Array<{ slot: number; guess: string; result: string }>;
      keys.add(encode(toFeedback(json, 5)));
    }
    assert.ok(keys.size > 1, `expected drifting secrets, got ${[...keys].join(',')}`);
  });

  it('solve seed=1 → fiery', { timeout: 120_000 }, async () => {
    const words = await loadWords(5);
    const firstGuess = (await loadOpening()) ?? 'tares';
    const result = await solve({
      oracle: createRandomOracle(1),
      words,
      firstGuess,
    });
    assert.equal(result.solved, true);
    assert.equal(result.answer, 'fiery');
  });

  it('solve seed=38 → agnew and uses probe', { timeout: 120_000 }, async () => {
    const words = await loadWords(5);
    const firstGuess = (await loadOpening()) ?? 'tares';
    const result = await solve({
      oracle: createRandomOracle(38),
      words,
      firstGuess,
    });
    assert.equal(result.solved, true);
    assert.equal(result.answer, 'agnew');
    assert.ok(result.history.some((step) => step.phase === 'probe'));
  });
});
