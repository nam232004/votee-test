import { parseArgs } from 'node:util';
import { createDailyOracle, createRandomOracle, createWordOracle } from './api.ts';
import { createKnowledge, describe, updateKnowledge } from './constraints.ts';
import { createLocalOracle, encode, isSolved } from './feedback.ts';
import { solve } from './solver.ts';
import type { GuessStrategy } from './strategy.ts';
import type { Oracle, SolveStep } from './types.ts';
import { loadOpening, loadWords } from './words.ts';

const RESET = '\x1b[0m';
const MARK_ANSI: Record<string, string> = {
  correct: '\x1b[42m\x1b[30m',
  present: '\x1b[43m\x1b[30m',
  absent: '\x1b[100m\x1b[37m',
};

function colorGuess(guess: string, step: SolveStep): string {
  return [...guess]
    .map((letter, i) => {
      const mark = step.feedback[i] ?? 'absent';
      return `${MARK_ANSI[mark] ?? ''}${letter}${RESET}`;
    })
    .join('');
}

function usage(message?: string): never {
  if (message) console.error(message);
  console.error(
    'Usage: node src/cli.ts --mode random|daily|word|offline [--target WORD] [--seed N] [--strategy entropy|minimax|freq] [--size 5] [--attempts 6]',
  );
  process.exit(2);
}

function parseNonNegInt(raw: string | undefined, flag: string, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) usage(`${flag} must be a non-negative integer`);
  return n;
}

function randomSeed(): number {
  return 1 + Math.floor(Math.random() * 2_147_483_646);
}

const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'random' },
    target: { type: 'string' },
    seed: { type: 'string' },
    strategy: { type: 'string', default: 'entropy' },
    size: { type: 'string', default: '5' },
    attempts: { type: 'string', default: '6' },
  },
  allowPositionals: true,
});

const mode = values.mode ?? 'random';
const strategy = (values.strategy ?? 'entropy') as GuessStrategy;
if (strategy !== 'entropy' && strategy !== 'minimax' && strategy !== 'freq') {
  usage(`unknown strategy "${values.strategy}"`);
}

const size = parseNonNegInt(values.size, '--size', 5);
const maxAttempts = parseNonNegInt(values.attempts, '--attempts', 6);
if (size < 1) usage('--size must be ≥ 1');

let seed: number | undefined;
let oracle: Oracle;
let header: string;

if (mode === 'random') {
  seed = values.seed !== undefined ? parseNonNegInt(values.seed, '--seed', 0) : randomSeed();
  oracle = createRandomOracle(seed, size);
  header = `mode=random  size=${size}  seed=${seed}  strategy=${strategy}`;
} else if (mode === 'daily') {
  oracle = createDailyOracle(size);
  header = `mode=daily  size=${size}  strategy=${strategy}`;
} else if (mode === 'word') {
  const target = values.target;
  if (!target) usage('--mode word requires --target');
  oracle = createWordOracle(target);
  header = `mode=word  target=${target.trim().toLowerCase()}  strategy=${strategy}`;
} else if (mode === 'offline') {
  const target = values.target;
  if (!target) usage('--mode offline requires --target');
  oracle = createLocalOracle(target.trim().toLowerCase());
  header = `mode=offline  target=${target.trim().toLowerCase()}  strategy=${strategy}`;
} else {
  usage(`unknown mode "${mode}"`);
}

console.log(header);

const words = await loadWords(size);
const firstGuess = (await loadOpening()) ?? 'tares';
const knowledge = createKnowledge(size);

const result = await solve({
  oracle,
  words,
  strategy,
  firstGuess: firstGuess.length === size ? firstGuess : undefined,
  maxAttempts,
  onProgress(step) {
    updateKnowledge(knowledge, step.guess, step.feedback);
    const solved = isSolved(step.feedback);
    console.log(
      `${String(step.attempt).padStart(2)}  ${colorGuess(step.guess, step)}  ${encode(step.feedback)}  remaining=${step.remaining}${solved ? '  solved' : ''}`,
    );
    console.log(`    ${describe(knowledge)}`);
  },
});

if (result.solved) {
  console.log(`Solved: ${result.answer} in ${result.attempts} guess(es)`);
  process.exit(0);
}

console.log('Not solved.');
process.exit(1);
