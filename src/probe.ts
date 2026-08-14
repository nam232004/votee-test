import { isSolved } from './feedback.ts';
import type { Feedback, Oracle, SolveStep } from './types.ts';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('');

/** Chặn vòng lặp vô hạn nếu API đổi luật. Về lý thuyết không bao giờ chạm tới. */
const MAX_PROBES = 40;

type Slots = {
  /** Chữ đã chắc chắn ở ô đó, null nếu chưa biết. */
  fixed: (string | null)[];
  /** Chữ chắc chắn không có ở bất kỳ đâu. */
  absent: Set<string>;
  /** bannedAt[i] — chữ chắc chắn không ở ô i. */
  bannedAt: Set<string>[];
  /** Chữ biết là có trong từ nhưng chưa gắn được vào ô nào. */
  floating: Set<string>;
};

/**
 * Dựng lại tri thức từ các lượt đã đoán, để phần dò không làm lại việc đã làm.
 */
function readHistory(history: SolveStep[], size: number): Slots {
  const slots: Slots = {
    fixed: new Array(size).fill(null),
    absent: new Set(),
    bannedAt: Array.from({ length: size }, () => new Set<string>()),
    floating: new Set(),
  };
  for (const step of history) apply(slots, step.guess, step.feedback);
  return slots;
}

function apply(slots: Slots, guess: string, feedback: Feedback): void {
  for (let i = 0; i < feedback.length; i++) {
    const letter = guess[i]!;
    switch (feedback[i]) {
      case 'correct':
        slots.fixed[i] = letter;
        slots.floating.delete(letter);
        break;
      case 'present':
        slots.bannedAt[i]!.add(letter);
        if (!slots.fixed.includes(letter)) slots.floating.add(letter);
        break;
      case 'absent':
        slots.absent.add(letter);
        break;
    }
  }
  deduce(slots);
}

/**
 * Chữ đã biết là có trong từ (`floating`) mà chỉ còn đúng một ô hợp lệ thì chốt luôn.
 *
 * Không làm bước này thì solver biết `v` nằm trong `votee` sau lượt `oquvw` nhưng vẫn
 * đoán thêm `vxyze` — lãng phí, vì bốn ô kia đã là `otee` nên `v` chỉ có thể ở ô còn lại.
 */
function deduce(slots: Slots): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const letter of [...slots.floating]) {
      const homes: number[] = [];
      for (let i = 0; i < slots.fixed.length; i++) {
        if (slots.fixed[i] === null && !slots.bannedAt[i]!.has(letter)) homes.push(i);
      }
      if (homes.length === 1) {
        slots.fixed[homes[0]!] = letter;
        slots.floating.delete(letter);
        changed = true;
      }
    }
  }
}

/**
 * Các chữ còn có thể ở ô `slot`, xếp theo thứ tự nên thử.
 *
 * Ưu tiên chữ đã biết là có trong từ (`floating`) vì chúng chắc chắn nằm ở một ô nào đó.
 * Rồi ưu tiên chữ chưa dùng trong cùng lượt này, để một lượt thử được nhiều chữ khác nhau.
 *
 * Ưu tiên đó KHÔNG được là ràng buộc cứng: từ bí mật có thể có chữ lặp (`queue`, `zzzzz`),
 * khi đó cùng một chữ phải được thử ở nhiều ô trong cùng một lượt.
 */
function lettersFor(slots: Slots, slot: number, usedInThisGuess: Set<string>): string[] {
  const allowed = (letter: string): boolean =>
    !slots.absent.has(letter) && !slots.bannedAt[slot]!.has(letter);

  const preferUnused = (letters: string[]): string[] => {
    const unused = letters.filter((letter) => !usedInThisGuess.has(letter));
    return unused.length > 0 ? unused : letters;
  };

  const floating = [...slots.floating].filter(allowed);
  return preferUnused(floating.length > 0 ? floating : ALPHABET.filter(allowed));
}

/** Chữ còn chưa biết là có trong từ hay không — đáng để đem đi thử. */
function untestedLetters(slots: Slots): string[] {
  const known = new Set([...slots.absent, ...slots.floating, ...slots.fixed.filter((l) => l !== null)]);
  return ALPHABET.filter((letter) => !known.has(letter));
}

/**
 * Tìm từ bí mật KHÔNG cần từ điển, bảo đảm kết thúc.
 *
 * Vì API chấm điểm độc lập từng ô (xem feedback.ts), mỗi lượt đoán là 5 phép thử song song:
 * đặt một chữ khác nhau vào mỗi ô chưa biết. Mỗi phản hồi đều loại bỏ được thứ gì đó —
 * `correct` chốt luôn ô đó, `absent` loại chữ khỏi TẤT CẢ các ô, `present` loại chữ khỏi
 * đúng ô đó nhưng cho biết nó nằm đâu đó nên sẽ được ưu tiên thử tiếp.
 *
 * Đây là phương án dự phòng khi suy luận theo từ điển bế tắc: từ bí mật của API có thể là
 * danh từ riêng hoặc dạng viết tắt (`agnew`, `xhosa`, `wasnt`) mà không từ điển nào phủ hết.
 */
export async function resolveByProbing(options: {
  oracle: Oracle;
  size: number;
  history: SolveStep[];
  onProgress?: (step: SolveStep) => void;
}): Promise<{ answer: string; steps: SolveStep[] }> {
  const { oracle, size, history, onProgress } = options;

  const slots = readHistory(history, size);
  const steps: SolveStep[] = [];
  let attempt = history.length;

  for (let probe = 0; probe < MAX_PROBES; probe++) {
    if (slots.fixed.every((letter) => letter !== null)) break;

    const usedInThisGuess = new Set<string>();

    // Ô chưa biết được chọn trước, vì chúng mới là thứ ta cần chốt.
    const letters = slots.fixed.map((fixed, slot) => {
      if (fixed !== null) return fixed;
      const candidates = lettersFor(slots, slot, usedInThisGuess);
      if (candidates.length === 0) {
        // Đã loại hết 26 chữ ở ô này. Nghĩa là ký tự thật ở đó không phải chữ cái a–z, hoặc
        // API đã đổi luật chấm điểm — không phải chuyện thuật toán đoán chưa tới.
        throw new Error(
          `Đã loại hết 26 chữ cái ở ô ${slot + 1}, nên ký tự thật ở đó không phải chữ a–z. ` +
            `API chỉ nhận guess gồm chữ cái nên ô này không thể đoán ra.`,
        );
      }
      const letter = candidates[0]!;
      usedInThisGuess.add(letter);
      return letter;
    });

    // Ô đã biết thì điền lại chữ cũ chỉ nhận về `correct` — không thêm thông tin gì. Đặt một
    // chữ chưa rõ vào đó thì lượt này thu được thêm một phép thử: `absent` loại chữ đó khỏi
    // mọi ô, `present` chứng minh nó nằm ở một trong các ô còn lại. Nhờ vậy lúc chỉ còn một
    // ô chưa biết, mỗi lượt vẫn thử được 5 chữ thay vì 1.
    const unclassified = untestedLetters(slots);
    slots.fixed.forEach((fixed, slot) => {
      if (fixed === null) return;
      const letter = unclassified.find((candidate) => !usedInThisGuess.has(candidate));
      if (letter === undefined) return;
      usedInThisGuess.add(letter);
      letters[slot] = letter;
    });

    const guess = letters.join('');
    const feedback = await oracle(guess);
    apply(slots, guess, feedback);

    attempt++;
    const step: SolveStep = {
      attempt,
      guess,
      feedback,
      remaining: 0,
      phase: 'probe',
      unresolvedSlots: slots.fixed.filter((letter) => letter === null).length,
    };
    steps.push(step);
    onProgress?.(step);
  }

  if (!slots.fixed.every((letter) => letter !== null)) {
    throw new Error(`Dò ${MAX_PROBES} lượt vẫn chưa xác định được từ — API có thể đã đổi luật.`);
  }
  const answer = slots.fixed.join('');

  // Các ô được chốt rải rác qua nhiều lượt, nên có thể chưa bao giờ gửi trọn từ này lên
  // server. Gửi một lượt xác nhận để kết quả được chính API khẳng định.
  const last = steps.at(-1);
  if (last?.guess !== answer) {
    const feedback = await oracle(answer);
    if (!isSolved(feedback)) {
      throw new Error(`Dò ra "${answer}" nhưng API không xác nhận — luật chấm điểm đã đổi?`);
    }
    const step: SolveStep = {
      attempt: attempt + 1,
      guess: answer,
      feedback,
      remaining: 1,
      phase: 'probe',
      unresolvedSlots: 0,
    };
    steps.push(step);
    onProgress?.(step);
  }
  return { answer, steps };
}
