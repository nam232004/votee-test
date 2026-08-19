import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRandomOracle, createWordOracle } from '../../src/api.ts';

describe('createWordOracle', () => {
  it('rejects a target that is not a-z', () => {
    assert.throws(() => createWordOracle('ar1se'), /a-z/);
    assert.throws(() => createWordOracle('apple!'), /a-z/);
    assert.throws(() => createWordOracle(''), /a-z/);
  });
});

describe('createRandomOracle', () => {
  it('rejects a missing or non-integer seed without hitting the network', () => {
    assert.throws(() => createRandomOracle(Number.NaN), /non-negative integer/);
    assert.throws(() => createRandomOracle(-1), /non-negative integer/);
    assert.throws(() => createRandomOracle(1.5), /non-negative integer/);
    assert.throws(() => createRandomOracle(undefined as unknown as number), /non-negative integer/);
  });
});
