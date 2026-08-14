import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledge, describe, satisfies, updateKnowledge } from '../../src/constraints.ts';
import { score } from '../../src/feedback.ts';
import { filterCandidates } from '../../src/filter.ts';
import { loadWords } from '../../src/words.ts';
import { deterministicPairs } from './helpers.ts';

const words = loadWords(5);

test('luật cập nhật đúng với ví dụ thật crane/fiery', () => {
  const knowledge = updateKnowledge(createKnowledge(5), 'crane', score('crane', 'fiery'));

  assert.deepEqual(knowledge.fixed, [null, null, null, null, null]);
  assert.deepEqual([...knowledge.required].sort(), ['e', 'r']);
  assert.deepEqual([...knowledge.forbidden].sort(), ['a', 'c', 'n']);
  assert.deepEqual([...knowledge.bannedAt[1]!], ['r']);
  assert.deepEqual([...knowledge.bannedAt[4]!], ['e']);
});

test('correct ghim chữ vào ô', () => {
  const knowledge = updateKnowledge(createKnowledge(5), 'tares', score('tares', 'doves'));
  assert.equal(knowledge.fixed[3], 'e');
  assert.equal(knowledge.fixed[4], 's');
});

/**
 * Đây là test quan trọng nhất của module: nó chứng minh constraint model và cách lọc bằng
 * so khớp pattern là TƯƠNG ĐƯƠNG. Nhờ vậy việc chỉ dùng constraint model để hiển thị là an
 * toàn — không có thông tin nào bị bỏ sót.
 */
test('constraint model và so khớp pattern cho cùng kết quả lọc', () => {
  for (const [target, guess] of deterministicPairs(words, 200)) {
    const feedback = score(guess, target);

    const byPattern = filterCandidates(words, guess, feedback);
    const knowledge = updateKnowledge(createKnowledge(5), guess, feedback);
    const byConstraints = words.filter((word) => satisfies(knowledge, word));

    assert.deepEqual(byConstraints, byPattern, `lệch ở target=${target} guess=${guess}`);
  }
});

test('tương đương vẫn giữ sau nhiều lượt tích luỹ', () => {
  const target = 'doves';
  let byPattern = words;
  const knowledge = createKnowledge(5);

  for (const guess of ['tares', 'lokes', 'nomes', 'caped']) {
    const feedback = score(guess, target);
    byPattern = filterCandidates(byPattern, guess, feedback);
    updateKnowledge(knowledge, guess, feedback);
    assert.deepEqual(words.filter((word) => satisfies(knowledge, word)), byPattern, `sau guess ${guess}`);
  }
});

test('describe đọc được và bỏ qua ô đã biết chắc', () => {
  const knowledge = updateKnowledge(createKnowledge(5), 'crane', score('crane', 'fiery'));
  const text = describe(knowledge);

  assert.match(text, /known: _ _ _ _ _/);
  assert.match(text, /must have: e,r/);
  assert.match(text, /ruled out: a,c,n/);
  assert.match(text, /not at: r@1, e@4/);
});
