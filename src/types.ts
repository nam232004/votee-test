export type Mark = 'absent' | 'present' | 'correct';
export type Feedback = Mark[];
export type Oracle = (guess: string) => Promise<Feedback>;

export type SolveStep = {
  attempt: number;
  guess: string;
  feedback: Feedback;
  remaining: number;
  phase: 'inference' | 'probe';
  unresolvedSlots?: number;
};

export type SolveResult = {
  solved: boolean;
  answer: string | null;
  attempts: number;
  history: SolveStep[];
};
