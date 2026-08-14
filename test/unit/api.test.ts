/**
 * Chỉ test phần validate tham số — nó throw trước khi gọi mạng, nên chạy được offline.
 * Phần hành vi HTTP thật nằm ở test/live/api.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandomOracle, createWordOracle } from '../../src/api.ts';

test('createWordOracle từ chối target có ký tự ngoài a–z', () => {
  for (const target of ['ab1cd', 'ap-le', 'ápple', 'ab cd', '']) {
    assert.throws(() => createWordOracle(target), /ngoài a–z/, `đáng ra phải từ chối "${target}"`);
  }
});

test('createWordOracle nhận mọi chuỗi chữ cái, kể cả từ vô nghĩa', () => {
  for (const target of ['apple', 'kshjc', 'zzzzz', 'APPLE', ' apple ']) {
    assert.doesNotThrow(() => createWordOracle(target));
  }
});

test('createRandomOracle bắt buộc có seed hợp lệ', () => {
  assert.throws(() => createRandomOracle(-1), /seed/);
  assert.throws(() => createRandomOracle(1.5), /seed/);
  assert.doesNotThrow(() => createRandomOracle(1));
});
