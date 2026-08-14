/**
 * Test tích hợp — CẦN MẠNG. Chạy bằng `npm run test:live`.
 *
 * Tách riêng khỏi test/unit để `npm test` luôn chạy được offline: mạng sập giữa buổi demo
 * thì bộ test vẫn xanh.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE_URL, createDailyOracle, createRandomOracle, createWordOracle } from '../../src/api.ts';
import { encode, score } from '../../src/feedback.ts';
import { solve } from '../../src/solver.ts';
import { loadOpening, loadWords } from '../../src/words.ts';

const words = loadWords(5);
const firstGuess = loadOpening();

/**
 * Test giá trị nhất trong repo: chứng minh hàm `score` local khớp API thật, kể cả ở các
 * case duplicate mà Wordle chuẩn sẽ trả về khác.
 */
test('contract: score() local khớp API thật', async () => {
  const cases: [target: string, guess: string][] = [
    ['apple', 'apple'],
    ['apple', 'zzzzz'],
    ['apple', 'arise'],
    ['apple', 'allee'],
    ['apple', 'eeeee'],
    ['apple', 'pppaa'],
    ['apple', 'pzzzp'],
    ['tests', 'tooot'],
    ['tests', 'ttttt'],
    ['teyyy', 'ttttt'],
  ];

  for (const [target, guess] of cases) {
    const fromApi = await createWordOracle(target)(guess);
    assert.equal(
      encode(fromApi),
      encode(score(guess, target)),
      `mô hình local lệch API ở target=${target} guess=${guess}`,
    );
  }
});

test('/random với seed cố định là deterministic', async () => {
  const oracle = createRandomOracle(1);
  const first = await oracle('arise');
  const second = await oracle('arise');
  assert.deepEqual(first, second);
});

/**
 * Tài liệu hoá phát hiện quan trọng nhất về API: không seed thì mỗi request là một từ bí
 * mật KHÁC NHAU, nên bài toán không giải được nếu không ghim seed.
 */
test('/random không seed thì từ bí mật thay đổi giữa các request', async () => {
  // Cố tình gọi thẳng, không qua oracle: api.ts không cho tạo random oracle thiếu seed.
  const seen = new Set<string>();
  for (let i = 0; i < 8; i++) {
    const response = await fetch(`${BASE_URL}/random?guess=arise&size=5`);
    const results = (await response.json()) as { slot: number; result: string }[];
    seen.add(results.map((item) => item.result[0]).join(''));
  }
  assert.ok(seen.size > 1, 'kỳ vọng thấy nhiều từ bí mật khác nhau khi không truyền seed');
});

test('giải được /random?seed=1 và ra đúng "fiery"', async () => {
  const result = await solve({ oracle: createRandomOracle(1), words, firstGuess });
  assert.ok(result.solved, 'không giải được seed=1');
  assert.equal(result.answer, 'fiery');
});

test('giải được /random với seed bất kỳ', async () => {
  for (const seed of [42, 777]) {
    const result = await solve({ oracle: createRandomOracle(seed), words, firstGuess });
    assert.ok(result.solved, `không giải được seed=${seed}`);
  }
});

test('giải được /daily', async () => {
  // Không assert từ cụ thể: đáp án đổi mỗi ngày.
  const result = await solve({ oracle: createDailyOracle(), words, firstGuess });
  assert.ok(result.solved, 'không giải được puzzle hôm nay');
});

test('guess sai độ dài thì báo lỗi rõ ràng', async () => {
  await assert.rejects(() => createWordOracle('apple')('abc'), /400/);
});
