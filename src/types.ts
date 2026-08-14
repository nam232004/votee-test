/** Kết quả server trả về cho MỘT ô. Dùng union type, không dùng enum (type stripping). */
export type Mark = 'absent' | 'present' | 'correct';

/** Feedback cho cả từ. index = slot, length = size. */
export type Feedback = Mark[];

/**
 * Nguồn cấp feedback. Ba endpoint của Votee đều thu về đúng shape này, nên solver
 * không cần biết nó đang chơi với /word, /random hay /daily.
 */
export type Oracle = (guess: string) => Promise<Feedback>;

export type SolveStep = {
  attempt: number;
  guess: string;
  feedback: Feedback;
  /** Số từ trong từ điển còn khả thi. Không có nghĩa ở giai đoạn `probe`. */
  remaining: number;
  /** `inference` suy luận theo từ điển; `probe` dò từng ô, không cần từ điển. */
  phase: 'inference' | 'probe';
  /** Số ô chưa xác định được — chỉ có ở giai đoạn `probe`. */
  unresolvedSlots?: number;
};

export type SolveResult = {
  solved: boolean;
  answer: string | null;
  attempts: number;
  history: SolveStep[];
};
