import type { Feedback, Mark, Oracle } from './types.ts';

export const BASE_URL = process.env['VOTEE_BASE_URL'] ?? 'https://wordle.votee.dev:8000';

type VoteeItem = { slot: number; guess: string; result: string };

const BACKOFF_MS = [300, 900] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Assemble Feedback by `slot`, not array order. */
export function toFeedback(items: VoteeItem[], size: number): Feedback {
  const marks: Array<Mark | undefined> = new Array(size);
  for (const item of items) {
    const result = item.result;
    if (result !== 'absent' && result !== 'present' && result !== 'correct') {
      throw new Error(`toFeedback(): unknown result "${result}"`);
    }
    if (item.slot < 0 || item.slot >= size) {
      throw new Error(`toFeedback(): slot ${item.slot} out of range for size ${size}`);
    }
    marks[item.slot] = result;
  }
  for (let i = 0; i < size; i++) {
    if (marks[i] === undefined) {
      throw new Error(`toFeedback(): missing slot ${i}`);
    }
  }
  return marks as Feedback;
}

function isRetryableNetwork(err: unknown): boolean {
  if (!(err instanceof Error)) return true;
  if (err.message.startsWith('HTTP ')) return false;
  return true;
}

async function request(path: string, guess: string): Promise<Feedback> {
  const normalized = guess.trim().toLowerCase();
  const sep = path.includes('?') ? '&' : '?';
  const url = `${BASE_URL}${path}${sep}guess=${encodeURIComponent(normalized)}`;

  let lastError: unknown;
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status >= 500) {
        const body = await res.text();
        lastError = new Error(`HTTP ${res.status} ${url} ${body}`);
        if (attempt < BACKOFF_MS.length) {
          await sleep(BACKOFF_MS[attempt]!);
          continue;
        }
        throw lastError;
      }
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status} ${url} ${body}`);
      }
      const json = (await res.json()) as VoteeItem[];
      if (!Array.isArray(json)) {
        throw new Error(`unexpected response from ${url}`);
      }
      return toFeedback(json, normalized.length);
    } catch (err) {
      if (!isRetryableNetwork(err)) throw err;
      lastError = err;
      if (attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt]!);
        continue;
      }
      throw lastError;
    }
  }
  throw lastError;
}

export function createWordOracle(target: string): Oracle {
  const word = target.trim().toLowerCase();
  if (!/^[a-z]+$/.test(word)) {
    throw new Error(`createWordOracle(): target must be a-z letters, got "${target}"`);
  }
  return (guess) => request(`/word/${encodeURIComponent(word)}`, guess);
}

export function createRandomOracle(seed: number, size = 5): Oracle {
  if (!Number.isInteger(seed) || seed < 0) {
    throw new Error(`createRandomOracle(): seed must be a non-negative integer, got ${seed}`);
  }
  return (guess) => request(`/random?size=${size}&seed=${seed}`, guess);
}

export function createDailyOracle(size = 5): Oracle {
  return (guess) => request(`/daily?size=${size}`, guess);
}
