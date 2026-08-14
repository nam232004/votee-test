import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalOracle } from '../../src/feedback.ts';
import { DictionaryGapError, solve } from '../../src/solver.ts';
import { loadOpening, loadWords } from '../../src/words.ts';
import { evenSample } from './helpers.ts';

const words = loadWords(5);
const firstGuess = loadOpening();

/** Từ bí mật thật của API, lấy được bằng cách dò 26 lượt aaaaa..zzzzz (xem README). */
const GROUND_TRUTH = ['fiery', 'wrote', 'poise', 'vetch'];

test('giải được các từ bí mật thật của API', async () => {
  for (const target of GROUND_TRUTH) {
    const result = await solve({ oracle: createLocalOracle(target), words, firstGuess });
    assert.ok(result.solved, `không giải được ${target}`);
    assert.equal(result.answer, target);
  }
});

test('history ghi lại đủ từng lượt', async () => {
  const result = await solve({ oracle: createLocalOracle('poise'), words, firstGuess });

  assert.equal(result.history.length, result.attempts);
  assert.equal(result.history[0]!.guess, firstGuess);
  // Candidate set phải co lại dần.
  const remaining = result.history.map((step) => step.remaining);
  assert.deepEqual(remaining, [...remaining].sort((a, b) => b - a));
});

test('từ ngoài từ điển vẫn tìm ra được nhờ chuyển sang dò', async () => {
  const result = await solve({ oracle: createLocalOracle('zzzzz'), words, firstGuess });
  assert.ok(result.solved);
  assert.equal(result.answer, 'zzzzz');
});

test('tắt fallback thì báo lỗi rõ ràng, không đoán bừa', async () => {
  await assert.rejects(
    () => solve({ oracle: createLocalOracle('zzzzz'), words, firstGuess, fallback: false }),
    DictionaryGapError,
  );
});

test('hết lượt suy luận mà tắt fallback thì trả solved=false chứ không throw', async () => {
  const result = await solve({
    oracle: createLocalOracle('doves'),
    words,
    firstGuess,
    maxAttempts: 2,
    fallback: false,
  });
  assert.equal(result.solved, false);
  assert.equal(result.answer, null);
});

test('hết lượt suy luận thì dò tiếp cho tới khi ra', async () => {
  const result = await solve({ oracle: createLocalOracle('doves'), words, firstGuess, maxAttempts: 2 });
  assert.ok(result.solved);
  assert.equal(result.answer, 'doves');
});

/**
 * Benchmark thu nhỏ. Ngưỡng dưới đây là số ĐO ĐƯỢC trên mẫu 1.000 từ (99,0% giải được,
 * 4,22 lượt trung bình), đã nới ra một chút cho dao động của mẫu 150.
 * Nếu test này fail, đừng nới ngưỡng — hãy xem lại strategy hoặc từ điển.
 */
test('benchmark: giải được ≥ 97% và trung bình ≤ 4,4 lượt', async () => {
  const targets = evenSample(words, 150);
  let solved = 0;
  let totalAttempts = 0;

  for (const target of targets) {
    // fallback tắt: đo riêng phần suy luận. Bật lên thì luôn 100% và số mất ý nghĩa.
    const result = await solve({ oracle: createLocalOracle(target), words, firstGuess, fallback: false });
    if (result.solved) {
      solved++;
      totalAttempts += result.attempts;
    }
  }

  const rate = solved / targets.length;
  const average = totalAttempts / solved;

  assert.ok(rate >= 0.97, `tỉ lệ giải chỉ ${(rate * 100).toFixed(1)}%`);
  assert.ok(average <= 4.4, `trung bình ${average.toFixed(2)} lượt`);
});
