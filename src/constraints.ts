import type { Feedback } from './types.ts';

/**
 * Tri thức tường minh về từ bí mật, tích luỹ qua các lượt.
 *
 * Module này CHỈ dùng để kể lại quá trình suy luận ra output. Việc lọc candidate do
 * `filter.ts` làm, bằng cách so khớp pattern. Hai cách tương đương về logic (có test
 * chứng minh trong test/unit/constraints.test.ts), nhưng so khớp pattern là một hàm thuần
 * nên ít bề mặt lỗi hơn, còn cấu trúc dưới đây thì giải thích được "vì sao".
 */
export type Knowledge = {
  size: number;
  /** fixed[0]='f' → ô 0 chắc chắn là 'f'. */
  fixed: (string | null)[];
  /** Chữ chắc chắn có trong từ, chưa biết ở đâu. */
  required: Set<string>;
  /** Chữ chắc chắn không có ở bất kỳ đâu. */
  forbidden: Set<string>;
  /** bannedAt[1] ∋ 'r' → ô 1 chắc chắn không phải 'r'. */
  bannedAt: Set<string>[];
};

export function createKnowledge(size: number): Knowledge {
  return {
    size,
    fixed: new Array(size).fill(null),
    required: new Set(),
    forbidden: new Set(),
    bannedAt: Array.from({ length: size }, () => new Set<string>()),
  };
}

export function updateKnowledge(knowledge: Knowledge, guess: string, feedback: Feedback): Knowledge {
  for (let i = 0; i < feedback.length; i++) {
    const letter = guess[i]!;
    switch (feedback[i]) {
      case 'correct':
        knowledge.fixed[i] = letter;
        break;
      case 'present':
        knowledge.required.add(letter);
        knowledge.bannedAt[i]!.add(letter);
        break;
      case 'absent':
        knowledge.forbidden.add(letter);
        break;
    }
  }
  return knowledge;
}

/** Chỉ dùng cho test tương đương với `filter.ts`. Solver không gọi hàm này. */
export function satisfies(knowledge: Knowledge, word: string): boolean {
  for (let i = 0; i < knowledge.size; i++) {
    const letter = word[i]!;
    const fixed = knowledge.fixed[i];
    if (fixed !== null && letter !== fixed) return false;
    if (knowledge.bannedAt[i]!.has(letter)) return false;
  }
  for (const letter of knowledge.required) {
    if (!word.includes(letter)) return false;
  }
  for (const letter of knowledge.forbidden) {
    if (word.includes(letter)) return false;
  }
  return true;
}

const sorted = (letters: Set<string>): string => [...letters].sort().join(',');

/** Ví dụ: `known: f _ _ _ _   must have: r,e   ruled out: c,a,n   not at: r@1, e@4` */
export function describe(knowledge: Knowledge): string {
  const parts = [`known: ${knowledge.fixed.map((letter) => letter ?? '_').join(' ')}`];

  if (knowledge.required.size > 0) parts.push(`must have: ${sorted(knowledge.required)}`);
  if (knowledge.forbidden.size > 0) parts.push(`ruled out: ${sorted(knowledge.forbidden)}`);

  const notAt = knowledge.bannedAt
    // Ô đã biết chắc thì việc liệt kê chữ bị loại ở ô đó chỉ làm output rối.
    .flatMap((letters, slot) =>
      knowledge.fixed[slot] !== null ? [] : [...letters].sort().map((letter) => `${letter}@${slot}`),
    )
    .join(', ');
  if (notAt) parts.push(`not at: ${notAt}`);

  return parts.join('   ');
}
