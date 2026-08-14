import test from 'node:test';
import assert from 'node:assert/strict';
import { score } from '../../src/feedback.ts';
import { filterCandidates, isConsistent } from '../../src/filter.ts';
import { loadWords } from '../../src/words.ts';
import { deterministicPairs } from './helpers.ts';

const words = loadWords(5);

test('từ bí mật thật luôn còn lại sau khi lọc', () => {
  for (const [target, guess] of deterministicPairs(words, 200)) {
    assert.ok(
      isConsistent(target, guess, score(guess, target)),
      `${target} bị loại oan bởi guess ${guess}`,
    );
  }
});

test('absent loại mọi từ chứa chữ đó ở bất kỳ vị trí', () => {
  const remaining = filterCandidates(words, 'zzzzz', score('zzzzz', 'apple'));
  assert.ok(remaining.every((word) => !word.includes('z')));
  assert.ok(remaining.includes('apple'));
});

test('present loại từ có chữ đó đúng ở ô vừa đoán', () => {
  const feedback = score('crane', 'fiery');
  const remaining = filterCandidates(words, 'crane', feedback);
  // 'r' là present ở ô 1 ⇒ mọi từ còn lại phải chứa 'r' nhưng không phải ở ô 1.
  assert.ok(remaining.every((word) => word.includes('r') && word[1] !== 'r'));
  assert.ok(remaining.includes('fiery'));
});

test('feedback toàn correct chỉ còn lại đúng một từ', () => {
  const remaining = filterCandidates(words, 'fiery', score('fiery', 'fiery'));
  assert.deepEqual(remaining, ['fiery']);
});

test('lọc luôn thu hẹp hoặc giữ nguyên, không bao giờ mở rộng', () => {
  let candidates = words;
  for (const guess of ['tares', 'lokes', 'nomes']) {
    const next = filterCandidates(candidates, guess, score(guess, 'doves'));
    assert.ok(next.length <= candidates.length);
    assert.ok(next.includes('doves'));
    candidates = next;
  }
});
