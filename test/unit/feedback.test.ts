import test from 'node:test';
import assert from 'node:assert/strict';
import { encode, isSolved, patternKey, score } from '../../src/feedback.ts';

/**
 * Đây KHÔNG phải case tự nghĩ ra: mỗi dòng là response thật của API Votee, thu được bằng
 * /word/{target}?guess=... Cột cuối cho thấy Wordle chuẩn sẽ trả về khác — đó là lý do
 * không thể dùng luật duplicate của Wordle cho API này.
 */
const VERIFIED: [target: string, guess: string, expected: string, standardWordle?: string][] = [
  ['apple', 'apple', 'ccccc'],
  ['apple', 'zzzzz', 'aaaaa'],
  ['apple', 'arise', 'caaac'],
  ['apple', 'allee', 'cpppc', 'capac'],
  ['apple', 'eeeee', 'ppppc', 'aaaac'],
  ['apple', 'pppaa', 'pccpp'],
  ['apple', 'pzzzp', 'paaap'],
  ['tests', 'tooot', 'caaap'],
  ['tests', 'ttttt', 'cppcp', 'caaca'],
  ['teyyy', 'ttttt', 'cpppp'],
];

test('score khớp đúng response thật của API', () => {
  for (const [target, guess, expected] of VERIFIED) {
    assert.equal(encode(score(guess, target)), expected, `${target} + ${guess}`);
  }
});

test('patternKey cho cùng kết quả với score nhưng dạng string', () => {
  for (const [target, guess] of VERIFIED) {
    assert.equal(patternKey(guess, target), encode(score(guess, target)));
  }
});

test('absent nghĩa là chữ không có ở bất kỳ đâu, không chỉ ở ô đó', () => {
  // 'p' xuất hiện ở apple nên không ô nào của guess được 'absent' cho 'p'.
  const marks = score('ppppp', 'apple');
  assert.ok(!marks.includes('absent'));
});

test('present không mang thông tin về số lượng', () => {
  // 'e' chỉ xuất hiện 1 lần trong apple, nhưng cả 4 ô sai vị trí đều là present.
  assert.equal(encode(score('eeeee', 'apple')), 'ppppc');
});

test('độ dài lệch thì throw chứ không đoán', () => {
  assert.throws(() => score('abc', 'apple'), /độ dài lệch/);
});

test('isSolved chỉ đúng khi toàn bộ là correct', () => {
  assert.ok(isSolved(score('apple', 'apple')));
  assert.ok(!isSolved(score('allee', 'apple')));
});
