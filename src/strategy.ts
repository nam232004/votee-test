import { patternKey } from './feedback.ts';

export type StrategyName = 'freq' | 'minimax' | 'entropy';

export type PickOptions = {
  strategy?: StrategyName;
  /** Toàn bộ từ điển, để cân nhắc guess "dò" không thể là đáp án. */
  dictionary?: string[];
  attemptsLeft?: number;
  /** Trên ngưỡng này thì phân hoạch quá đắt ⇒ tạm về heuristic tần suất. */
  maxPartitionCandidates?: number;
  /** Dưới ngưỡng này mới cân nhắc guess dò từ toàn từ điển. */
  probeMaxCandidates?: number;
};

const DEFAULTS = {
  maxPartitionCandidates: 300,
  probeMaxCandidates: 30,
} as const;

/**
 * Heuristic: chọn từ có các chữ phổ biến nhất theo từng vị trí.
 *
 * Bám ý tưởng positional frequency của kênh The Dodgy Engineer, nhưng dùng tổng tần suất
 * rồi maximize, thay cho công thức Π(maxFreq − freq) rồi minimize của video. Công thức gốc
 * vỡ khi bất kỳ vị trí nào đạt maxFreq: tích thành 0 nên hàng loạt từ đồng điểm và việc
 * chọn trở thành ngẫu nhiên.
 */
function scoreByFrequency(candidates: string[]): Map<string, number> {
  const size = candidates[0]!.length;
  const frequency: Map<string, number>[] = Array.from({ length: size }, () => new Map());

  for (const word of candidates) {
    for (let i = 0; i < size; i++) {
      const slot = frequency[i]!;
      const letter = word[i]!;
      slot.set(letter, (slot.get(letter) ?? 0) + 1);
    }
  }

  const scores = new Map<string, number>();
  for (const word of candidates) {
    let score = 0;
    for (let i = 0; i < size; i++) {
      score += frequency[i]!.get(word[i]!) ?? 0;
    }
    // Vì API đánh giá độc lập từng ô, chữ lặp gần như không mang thêm thông tin.
    const duplicates = size - new Set(word).size;
    scores.set(word, score * 0.5 ** duplicates);
  }
  return scores;
}

/** Kích thước các nhóm mà `guess` chia `candidates` thành. */
function partitionSizes(guess: string, candidates: string[]): number[] {
  const buckets = new Map<string, number>();
  for (const candidate of candidates) {
    const key = patternKey(guess, candidate);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.values()];
}

/** Nhóm lớn nhất — số từ còn lại trong trường hợp xấu nhất. Càng nhỏ càng tốt. */
function worstCase(sizes: number[]): number {
  return Math.max(...sizes);
}

/** Lượng thông tin kỳ vọng thu được, tính bằng bit. Càng lớn càng tốt. */
function entropyBits(sizes: number[], total: number): number {
  let bits = 0;
  for (const size of sizes) {
    const p = size / total;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/**
 * Chọn guess kế tiếp. Deterministic: cùng input luôn cho cùng output.
 *
 * Tie-break ưu tiên guess nằm trong tập candidate, để giữ cơ hội thắng ngay lượt này khi
 * hai guess chia nhóm tốt bằng nhau.
 */
export function pickGuess(candidates: string[], options: PickOptions = {}): string {
  if (candidates.length === 0) throw new Error('pickGuess(): không còn candidate nào');
  if (candidates.length === 1) return candidates[0]!;

  const strategy = options.strategy ?? 'freq';
  const maxPartition = options.maxPartitionCandidates ?? DEFAULTS.maxPartitionCandidates;
  const probeMax = options.probeMaxCandidates ?? DEFAULTS.probeMaxCandidates;

  const tooExpensive = candidates.length > maxPartition;
  if (strategy === 'freq' || tooExpensive) {
    const scores = scoreByFrequency(candidates);
    return best(candidates, (word) => scores.get(word)!, 'max', candidates);
  }

  // Khi còn ít candidate và chúng khác nhau quá ít (kiểu light/might/night/right), một từ
  // không thể là đáp án vẫn có thể tách được nhiều từ cùng lúc. Chỉ mở rộng pool khi còn
  // đủ lượt để dùng thông tin đó.
  const canProbe =
    options.dictionary !== undefined &&
    candidates.length <= probeMax &&
    (options.attemptsLeft ?? 0) > 1;
  const pool = canProbe ? options.dictionary! : candidates;

  const total = candidates.length;
  if (strategy === 'entropy') {
    return best(pool, (guess) => entropyBits(partitionSizes(guess, candidates), total), 'max', candidates);
  }
  return best(pool, (guess) => worstCase(partitionSizes(guess, candidates)), 'min', candidates);
}

/**
 * Chọn phần tử tối ưu theo `valueOf`. Tie-break: ưu tiên từ nằm trong `preferred`, sau đó
 * theo thứ tự alphabet — nhờ vậy kết quả không phụ thuộc thứ tự đầu vào.
 */
function best(
  pool: string[],
  valueOf: (word: string) => number,
  direction: 'min' | 'max',
  preferred: string[],
): string {
  const preferredSet = new Set(preferred);
  const sign = direction === 'max' ? 1 : -1;

  let bestWord = '';
  let bestValue = -Infinity;
  let bestPreferred = false;

  for (const word of pool) {
    const value = sign * valueOf(word);
    const isPreferred = preferredSet.has(word);

    if (
      value > bestValue ||
      (value === bestValue && !bestPreferred && isPreferred) ||
      (value === bestValue && bestPreferred === isPreferred && word < bestWord)
    ) {
      bestWord = word;
      bestValue = value;
      bestPreferred = isPreferred;
    }
  }
  return bestWord;
}
