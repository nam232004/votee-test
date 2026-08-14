/**
 * PRNG deterministic (mulberry32) để test lặp lại được mà không cần dependency.
 * Test flaky tệ hơn không có test.
 */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Các cặp (target, guess) rải đều trong từ điển, giống nhau giữa các lần chạy. */
export function deterministicPairs(words: string[], count: number, seed = 20260814): [string, string][] {
  const random = createRandom(seed);
  const pick = (): string => words[Math.floor(random() * words.length)]!;
  return Array.from({ length: count }, () => [pick(), pick()]);
}

/** Mẫu target rải đều, dùng cho benchmark trong test. */
export function evenSample(words: string[], count: number): string[] {
  const step = Math.max(1, Math.floor(words.length / count));
  return words.filter((_, i) => i % step === 0).slice(0, count);
}
