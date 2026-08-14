import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalOracle } from '../../src/feedback.ts';
import { resolveByProbing } from '../../src/probe.ts';
import { DictionaryGapError, solve } from '../../src/solver.ts';
import { loadOpening, loadWords } from '../../src/words.ts';

const words = loadWords(5);
const firstGuess = loadOpening();

/**
 * Từ bí mật thật của API mà từ điển KHÔNG chứa: danh từ riêng và dạng viết tắt. Tìm được
 * bằng cách chạy 60 seed rồi tái tạo từ bằng cách dò.
 */
const OUTSIDE_DICTIONARY = ['agnew', 'xhosa', 'aruba', 'rabin', 'wasnt', 'thule', 'somal', 'della', 'fecal'];

test('dò ra được từ nằm ngoài từ điển', async () => {
  for (const target of OUTSIDE_DICTIONARY) {
    const { answer } = await resolveByProbing({
      oracle: createLocalOracle(target),
      size: 5,
      history: [],
    });
    assert.equal(answer, target);
  }
});

test('dò được cả những từ hiểm: chữ lặp, toàn nguyên âm, chữ hiếm', async () => {
  for (const target of ['aaaaa', 'zzzzz', 'queue', 'jazzy', 'aeiou']) {
    const { answer } = await resolveByProbing({
      oracle: createLocalOracle(target),
      size: 5,
      history: [],
    });
    assert.equal(answer, target);
  }
});

test('lượt cuối luôn là chính đáp án, được API xác nhận', async () => {
  const { answer, steps } = await resolveByProbing({
    oracle: createLocalOracle('agnew'),
    size: 5,
    history: [],
  });
  const last = steps.at(-1)!;
  assert.equal(last.guess, answer);
  assert.ok(last.feedback.every((mark) => mark === 'correct'));
});

test('dò tận dụng thông tin từ các lượt suy luận trước', async () => {
  const target = 'agnew';
  const fresh = await resolveByProbing({ oracle: createLocalOracle(target), size: 5, history: [] });

  const warm = await solve({ oracle: createLocalOracle(target), words, firstGuess });
  const probeSteps = warm.history.filter((step) => step.phase === 'probe').length;

  // Đã biết sẵn vài ràng buộc thì phải dò ít hơn là bắt đầu từ con số không.
  assert.ok(probeSteps < fresh.steps.length, `dò ${probeSteps} lượt, không tận dụng được gì`);
});

test('solver tự chuyển sang dò và luôn giải được', async () => {
  for (const target of OUTSIDE_DICTIONARY) {
    const result = await solve({ oracle: createLocalOracle(target), words, firstGuess });
    assert.ok(result.solved, `không giải được ${target}`);
    assert.equal(result.answer, target);
    assert.ok(
      result.history.some((step) => step.phase === 'probe'),
      'đáng ra phải có giai đoạn dò',
    );
  }
});

test('từ trong từ điển vẫn giải bằng suy luận, không dò', async () => {
  for (const target of ['fiery', 'wrote', 'poise', 'vetch']) {
    const result = await solve({ oracle: createLocalOracle(target), words, firstGuess });
    assert.ok(result.history.every((step) => step.phase === 'inference'), `${target} lại phải dò`);
  }
});

test('tắt fallback thì báo lỗi rõ ràng thay vì dò', async () => {
  await assert.rejects(
    () => solve({ oracle: createLocalOracle('agnew'), words, firstGuess, fallback: false }),
    DictionaryGapError,
  );
});
