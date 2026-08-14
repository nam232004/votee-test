import type { Feedback, Mark, Oracle } from './types.ts';

export const BASE_URL = process.env['VOTEE_BASE_URL'] ?? 'https://wordle.votee.dev:8000';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 300;

type GuessResult = { slot: number; guess: string; result: Mark };

/**
 * Biên giới duy nhất biết đến hình dạng response của Votee. Mọi module khác chỉ thấy
 * `Feedback` (tức `Mark[]`), nên toàn bộ logic test được offline.
 */
async function request(path: string, guess: string): Promise<Feedback> {
  const normalised = guess.trim().toLowerCase();
  const url = `${BASE_URL}${path}${path.includes('?') ? '&' : '?'}guess=${encodeURIComponent(normalised)}`;

  const payload = await fetchWithRetry(url);
  return toFeedback(payload, normalised);
}

async function fetchWithRetry(url: string): Promise<GuessResult[]> {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url);
    } catch (cause) {
      // Lỗi mạng: đáng thử lại.
      if (attempt >= MAX_RETRIES) throw new Error(`Không gọi được ${url}`, { cause });
      await delay(RETRY_DELAY_MS * 3 ** attempt);
      continue;
    }

    if (response.ok) return (await response.json()) as GuessResult[];

    const body = await response.text().catch(() => '');
    // 4xx là lỗi của phía ta (guess sai độ dài, ký tự không hợp lệ) ⇒ thử lại vô nghĩa.
    if (response.status < 500 || attempt >= MAX_RETRIES) {
      throw new Error(`${response.status} ${response.statusText} từ ${url}${body ? ` — ${body}` : ''}`);
    }
    await delay(RETRY_DELAY_MS * 3 ** attempt);
  }
}

/** Dựng theo `slot`, không dựa vào thứ tự phần tử trong array. */
function toFeedback(results: GuessResult[], guess: string): Feedback {
  const feedback: (Mark | undefined)[] = new Array(guess.length);
  for (const { slot, result } of results) {
    feedback[slot] = result;
  }

  const missing = feedback.findIndex((mark) => mark === undefined);
  if (missing !== -1) {
    throw new Error(`Response thiếu slot ${missing} cho guess "${guess}": ${JSON.stringify(results)}`);
  }
  return feedback as Feedback;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Ta tự chọn từ bí mật ⇒ dùng làm test oracle, không phải để chơi. */
export function createWordOracle(target: string): Oracle {
  return (guess) => request(`/word/${encodeURIComponent(target.toLowerCase())}`, guess);
}

/**
 * `seed` là bắt buộc, không phải tuỳ chọn. API stateless và không seed thì MỖI request là
 * một từ bí mật khác nhau, nên solver sẽ không bao giờ hội tụ.
 */
export function createRandomOracle(seed: number, size = 5): Oracle {
  if (!Number.isInteger(seed) || seed < 0) {
    throw new Error(`createRandomOracle(): seed phải là số nguyên không âm, nhận được ${seed}`);
  }
  return (guess) => request(`/random?size=${size}&seed=${seed}`, guess);
}

export function createDailyOracle(size = 5): Oracle {
  return (guess) => request(`/daily?size=${size}`, guess);
}
