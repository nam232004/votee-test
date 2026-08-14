import test from 'node:test';
import assert from 'node:assert/strict';
import { patternKey } from '../../src/feedback.ts';
import { pickGuess } from '../../src/strategy.ts';
import { loadWords } from '../../src/words.ts';

const words = loadWords(5);

test('deterministic: cùng input luôn cho cùng output', () => {
  for (const strategy of ['freq', 'minimax', 'entropy'] as const) {
    const candidates = words.slice(0, 120);
    assert.equal(pickGuess(candidates, { strategy }), pickGuess(candidates, { strategy }));
  }
});

test('không phụ thuộc thứ tự đầu vào', () => {
  const candidates = words.slice(500, 620);
  const shuffled = [...candidates].reverse();
  assert.equal(pickGuess(candidates, { strategy: 'entropy' }), pickGuess(shuffled, { strategy: 'entropy' }));
});

test('còn một candidate thì đoán luôn từ đó', () => {
  assert.equal(pickGuess(['fiery']), 'fiery');
});

test('candidate rỗng thì throw', () => {
  assert.throws(() => pickGuess([]), /không còn candidate/);
});

test('heuristic tần suất trừ điểm từ có chữ lặp', () => {
  // Hai từ cùng khung nhưng 'seses' lặp chữ ⇒ không được chọn.
  const candidates = ['sales', 'seses', 'sages', 'sanes'];
  assert.notEqual(pickGuess(candidates, { strategy: 'freq' }), 'seses');
});

test('minimax chọn guess chia nhóm đều hơn', () => {
  const candidates = words.slice(2000, 2150);
  const guess = pickGuess(candidates, { strategy: 'minimax' });

  const worstOf = (word: string): number => {
    const buckets = new Map<string, number>();
    for (const candidate of candidates) {
      const key = patternKey(word, candidate);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return Math.max(...buckets.values());
  };

  const chosen = worstOf(guess);
  for (const other of candidates) {
    assert.ok(chosen <= worstOf(other), `${other} chia tốt hơn ${guess}`);
  }
});

test('trên ngưỡng phân hoạch thì tự về heuristic để không treo', () => {
  const started = Date.now();
  const guess = pickGuess(words, { strategy: 'entropy', maxPartitionCandidates: 300 });
  assert.ok(words.includes(guess));
  assert.ok(Date.now() - started < 2000, 'phải nhanh vì đã hạ về heuristic');
});

test('cân nhắc guess "dò" ngoài tập candidate khi bí', () => {
  // Họ _o_es chỉ khác nhau một ô: một từ không thể là đáp án vẫn có thể tách được nhiều
  // từ cùng lúc, nên pool được mở rộng ra toàn từ điển.
  const candidates = ['doges', 'doles', 'domes', 'dopes', 'doses', 'dotes', 'doves', 'dozes'];
  const guess = pickGuess(candidates, {
    strategy: 'entropy',
    dictionary: words,
    attemptsLeft: 3,
  });
  assert.ok(!candidates.includes(guess), `đáng ra phải dò, nhưng lại đoán ${guess}`);
});
