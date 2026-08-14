import { parseArgs } from 'node:util';
import { createDailyOracle, createRandomOracle, createWordOracle } from './api.ts';
import { benchmark, type BenchOptions } from './bench.ts';
import { createKnowledge, describe, updateKnowledge } from './constraints.ts';
import { createLocalOracle } from './feedback.ts';
import { solve } from './solver.ts';
import type { StrategyName } from './strategy.ts';
import { loadOpening, loadWords } from './words.ts';
import type { Feedback, Mark, Oracle, SolveStep } from './types.ts';

const COLOURS: Record<Mark, string> = {
  correct: '\x1b[30;102m',
  present: '\x1b[30;103m',
  absent: '\x1b[37;100m',
};
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

const paint = (guess: string, feedback: Feedback): string =>
  feedback.map((mark, i) => `${COLOURS[mark]} ${guess[i]!.toUpperCase()} ${RESET}`).join('');

const count = (n: number): string => n.toLocaleString('en-US');

function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      mode: { type: 'string', default: 'random' },
      target: { type: 'string' },
      seed: { type: 'string' },
      size: { type: 'string', default: '5' },
      strategy: { type: 'string', default: 'entropy' },
      partition: { type: 'string' },
      attempts: { type: 'string', default: '6' },
      count: { type: 'string', default: '300' },
    },
  });

  const size = Number(values.size);
  const maxAttempts = Number(values.attempts);
  const strategy = values.strategy as StrategyName;
  const words = loadWords(size);
  const firstGuess = loadOpening();
  const maxPartitionCandidates = values.partition !== undefined ? Number(values.partition) : undefined;

  if (values.mode === 'bench') {
    return report({ words, sampleSize: Number(values.count), strategy, maxAttempts, maxPartitionCandidates, firstGuess });
  }

  const { oracle, label } = buildOracle(values, size);
  return play({ oracle, label, words, size, strategy, maxAttempts, maxPartitionCandidates, firstGuess });
}

function buildOracle(
  values: { mode?: string; target?: string; seed?: string },
  size: number,
): { oracle: Oracle; label: string } {
  switch (values.mode) {
    case 'word': {
      const target = values.target;
      if (!target) throw new Error('--mode word cần --target, ví dụ: --mode word --target apple');
      // Đáp án do ta chọn, nên đây là môi trường test có kiểm soát.
      return { oracle: createWordOracle(target), label: `mode=word  target=${target}` };
    }
    case 'daily':
      return { oracle: createDailyOracle(size), label: `mode=daily  size=${size}` };
    case 'random': {
      // Không có seed thì mỗi request là một từ khác nhau, nên phải ghim một seed cho cả phiên.
      const seed = values.seed !== undefined ? Number(values.seed) : randomSeed();
      return { oracle: createRandomOracle(seed, size), label: `mode=random  size=${size}  seed=${seed}` };
    }
    case 'offline': {
      const target = values.target;
      if (!target) throw new Error('--mode offline cần --target');
      return { oracle: createLocalOracle(target), label: `mode=offline  target=${target}` };
    }
    default:
      throw new Error(`Mode không hợp lệ: "${values.mode}". Dùng random | daily | word | offline | bench`);
  }
}

const randomSeed = (): number => Math.floor(Math.random() * 1_000_000) + 1;

async function play(options: {
  oracle: Oracle;
  label: string;
  words: string[];
  size: number;
  strategy: StrategyName;
  maxAttempts: number;
  maxPartitionCandidates: number | undefined;
  firstGuess: string | undefined;
}): Promise<number> {
  const { oracle, label, words, size, strategy, maxAttempts, maxPartitionCandidates, firstGuess } = options;

  console.log('\nVotee Wordle Solver');
  console.log(`${label}  strategy=${strategy}`);
  console.log(`${DIM}dictionary: ${count(words.length)} words${RESET}\n`);

  const knowledge = createKnowledge(size);
  const started = Date.now();

  let announcedProbe = false;
  const onProgress = (step: SolveStep): void => {
    if (step.phase === 'probe' && !announcedProbe) {
      announcedProbe = true;
      console.log(
        `${DIM}Từ bí mật không có trong từ điển. Chuyển sang dò từng ô — chậm hơn nhưng luôn tìm ra.${RESET}\n`,
      );
    }

    updateKnowledge(knowledge, step.guess, step.feedback);
    console.log(`#${step.attempt}  ${paint(step.guess, step.feedback)}  ${step.guess}`);
    console.log(`    ${DIM}${describe(knowledge)}${RESET}`);

    const detail =
      step.phase === 'probe'
        ? `slots left to resolve: ${step.unresolvedSlots}`
        : `candidates remaining: ${count(step.remaining)}`;
    console.log(`    ${DIM}${detail}${RESET}\n`);
  };

  const result = await solve({ oracle, words, maxAttempts, strategy, maxPartitionCandidates, firstGuess, onProgress });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  if (result.solved) {
    console.log(`SOLVED  "${result.answer}"  in ${result.attempts} guesses  ${DIM}(${elapsed}s)${RESET}\n`);
    return 0;
  }
  console.log(`NOT SOLVED trong ${maxAttempts} lượt.\n`);
  return 1;
}

async function report(options: BenchOptions): Promise<number> {
  const result = await benchmark(options);
  const { targets, solved, distribution, failures } = result;

  console.log(`\nBenchmark  strategy=${options.strategy}  sample=${targets}  dictionary=${count(options.words.length)}`);
  console.log(`solved     ${solved}/${targets}  (${((solved / targets) * 100).toFixed(1)}%)`);
  console.log(`average    ${result.averageAttempts.toFixed(2)} guesses`);
  console.log(`elapsed    ${result.seconds.toFixed(1)}s\n`);

  for (let attempts = 1; attempts <= options.maxAttempts; attempts++) {
    const n = distribution.get(attempts) ?? 0;
    console.log(`${attempts}  ${String(n).padStart(4)}  ${'#'.repeat(Math.round((n / targets) * 50))}`);
  }
  if (failures.length > 0) {
    console.log(`\nsuy luận không xong trong ${options.maxAttempts} lượt: ${failures.join(', ')}`);
    console.log(`${DIM}Benchmark tắt fallback để đo riêng phần suy luận; chạy thật thì phần dò giải nốt các từ này.${RESET}`);
  }
  console.log();

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  });
