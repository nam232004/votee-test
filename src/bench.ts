import { createLocalOracle } from './feedback.ts';
import { solve } from './solver.ts';
import type { StrategyName } from './strategy.ts';

export type BenchOptions = {
  words: string[];
  sampleSize: number;
  strategy: StrategyName;
  maxAttempts: number;
  maxPartitionCandidates: number | undefined;
  firstGuess: string | undefined;
};

export type BenchReport = {
  targets: number;
  solved: number;
  averageAttempts: number;
  distribution: Map<number, number>;
  failures: string[];
  seconds: number;
};

/**
 * Đo chất lượng thuật toán bằng oracle local: không cần mạng, không giới hạn số lần gọi,
 * nên chạy được vài nghìn ván trong vài chục giây.
 *
 * Mẫu lấy rải đều và deterministic để hai lần chạy so sánh được với nhau — đổi strategy
 * mà mẫu cũng đổi thì con số vô nghĩa.
 */
export async function benchmark(options: BenchOptions): Promise<BenchReport> {
  const { words, sampleSize, ...solveOptions } = options;
  const step = Math.max(1, Math.floor(words.length / sampleSize));
  const targets = words.filter((_, i) => i % step === 0).slice(0, sampleSize);

  const distribution = new Map<number, number>();
  const failures: string[] = [];
  let totalAttempts = 0;
  const started = Date.now();

  for (const target of targets) {
    // Tắt fallback: benchmark đo riêng chất lượng phần suy luận theo từ điển. Bật lên thì
    // tỉ lệ giải luôn là 100% và con số mất ý nghĩa so sánh.
    const result = await solve({ oracle: createLocalOracle(target), words, fallback: false, ...solveOptions });
    if (result.solved) {
      totalAttempts += result.attempts;
      distribution.set(result.attempts, (distribution.get(result.attempts) ?? 0) + 1);
    } else {
      failures.push(target);
    }
  }

  const solved = targets.length - failures.length;
  return {
    targets: targets.length,
    solved,
    averageAttempts: totalAttempts / solved,
    distribution,
    failures,
    seconds: (Date.now() - started) / 1000,
  };
}
