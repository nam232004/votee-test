import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLocalOracle, score } from '../../src/feedback.ts';
import { createSlots, deduce, resolveByProbing } from '../../src/probe.ts';
import { solve } from '../../src/solver.ts';
import { loadOpening, loadWords } from '../../src/words.ts';

describe('resolveByProbing', () => {
  it('solves zzzzz when it is not in the dictionary', async () => {
    const words = await loadWords(5);
    assert.equal(words.includes('zzzzz'), false);
    const firstGuess = (await loadOpening()) ?? 'tares';
    const result = await solve({
      oracle: createLocalOracle('zzzzz'),
      words,
      firstGuess,
      fallback: true,
    });
    assert.equal(result.solved, true);
    assert.equal(result.answer, 'zzzzz');
    assert.ok(result.history.some((step) => step.phase === 'probe'));
  });

  it('deduce places a present letter when only one slot remains', () => {
    const slots = createSlots(5);
    slots.fixed = [null, 'o', 't', 'e', 'e'];
    slots.floating.add('v');
    deduce(slots);
    assert.equal(slots.fixed[0], 'v');
    assert.equal(slots.floating.has('v'), false);
  });

  it('does not emit a junk xyz guess after v can be deduced', async () => {
    const history = [
      {
        attempt: 1,
        guess: 'avtee',
        feedback: score('avtee', 'votee'),
        remaining: 0,
        phase: 'inference' as const,
      },
    ];
    const probes: string[] = [];
    const { answer } = await resolveByProbing({
      oracle: createLocalOracle('votee'),
      size: 5,
      history,
      onProgress(step) {
        probes.push(step.guess);
      },
    });
    assert.equal(answer, 'votee');
    assert.equal(probes.includes('vxyze'), false);
    assert.notEqual(probes[0]?.[0], 'v');
  });
});
