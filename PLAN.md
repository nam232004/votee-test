# PLAN — Votee Wordle Solver (TypeScript, zero build step, zero runtime deps)

> This is an **execution spec**, not code. Every API claim here was **verified with live
> requests** (Appendix A) — not guessed. Read this to understand *why* the modules exist;
> `README.md` is how to run them.

---

## 0. Design question: 3 APIs = 3 features, or one algorithm?

**Conclusion: the three endpoints are not three features. They are three sources of the same thing — an `oracle`.**

All three share one signature and one response shape:

```
(guess, size) -> GuessResult[]      // GuessResult = { slot, guess, result: absent|present|correct }
```

The only difference is *who holds the secret*:

| Endpoint | Who holds the secret | Role in this task |
| --- | --- | --- |
| `GET /word/{word}` | **We pick it** | Test oracle. Known answer ⇒ verify the solver, not "play" |
| `GET /random` | Server, hidden | **This is the brief** ("automatically guesses random words") |
| `GET /daily` | Server, hidden, fixed per day | A second real puzzle for demo |

A UI with three dropdowns, one per endpoint, **misreads the brief**. The email asks for a program that **automatically** guesses random words. Graders look at **inference**, not at whether you can hit three URLs.

Correct architecture: **one solver + one oracle interface with three implementations**:

```
                    ┌── wordOracle(target)   → /word/{target}   (tests)
solver(oracle) ─────┼── randomOracle(seed)   → /random?seed=…   (the actual task)
                    └── dailyOracle()        → /daily
```

The solver **does not know** which endpoint it is talking to. That is the live-coding pitch: the same algorithm runs against a known-answer test *and* a hidden puzzle.

**What to ship:** solver + CLI + tests. A thin English page that calls the **same** `solve()` is welcome — it is not a second algorithm, and it is not three features.

---

## 1. Highest-value finding — `/random` is STATELESS and not deterministic without `seed`

This is the trap. None of the three endpoints has a session. Each request is independent. On `/random`, **omitting `seed` means every request is a different secret**:

```
GET /random?guess=arise&size=5   → a=present r=present i=absent s=absent e=absent
GET /random?guess=arise&size=5   → a=absent   r=correct i=absent s=absent e=absent   ← different word
```

⇒ **You cannot solve `/random` without pinning a `seed`.** With a seed it is fully deterministic (same seed + same guess ⇒ same result — verified).

**Hard requirement:** in `random` mode, if the user does not pass `--seed`, the CLI **generates one positive integer once at the start of the session**, prints it, and reuses it for **every** guess. The word is still chosen by the server (we do not know it); the problem is well-posed.

> Highest-value finding. Most solvers miss this, or they "never converge" and do not know why.

---

## 2. Scoring — VERIFIED, and it is NOT standard Wordle

The API scores **each slot independently**. There is no Wordle-style duplicate allocator:

```
For each index i:
  if   guess[i] === target[i]      → "correct"
  elif target.includes(guess[i])   → "present"
  else                             → "absent"
```

Verified against live `/word` (Appendix A). The decisive pair:

| target | guess | API | Standard Wordle |
| --- | --- | --- | --- |
| `apple` | `allee` | `c p p p c` | `c a p a c` (only one `l`; second `e` already spent) |
| `tests` | `ttttt` | `c p p c p` | `c a a c a` |
| `apple` | `eeeee` | `p p p p c` | `a a a a c` |

**Three consequences the code must get right:**

1. `absent` ⟺ that letter occurs **nowhere** in the target (stronger than Wordle). A letter cannot be `correct` in one slot and `absent` in another.
2. `present` carries **no count**. You cannot infer "target has ≥2 e's". Do **not** implement min/max-count constraints from a typical Wordle solver. They will be **wrong**.
3. Repeated letters in a guess are **pure waste** (`aaaaa` only tells you whether `a` exists and where). Strategy must **penalise** repeats.

**Worth a README paragraph (do not use as the solver):** because scoring is per-slot, you *could* reconstruct any secret with 26 guesses `aaaaa`…`zzzzz`. I used that only to get ground truth: `seed=1 → fiery`, `seed=42 → wrote`, `seed=777 → poise`, `daily → vetch`. Frame it as a semantics finding, and say why we do not ship it: the brief asks for inference, and 26 guesses lose to ~4.

---

## 3. Dictionary — decision and acceptance

Ground truth includes rare words (`vetch`). ⇒ **Do not use Wordle's 2,315-answer list.** Use a full list of valid 5-letter words (~13k–16k).

Keep **zero runtime dependencies**:

1. Dev-only script `scripts/build-words.ts` reads an npm **devDependency** (`word-list`, MIT, data from SCOWL), keeps `^[a-z]{5}$`, sort, dedupe.
2. Write `data/words5.txt` and **commit it**. Runtime is `readFile` only.
3. Credit source + license in README (the email is explicit about plagiarism).

`word-list` yields **12,578** five-letter words and contains `fiery`, `wrote`, `poise`, `vetch`. Keep this source. It does **not** contain `agnew` / `votee` — that is why probe exists.

**Acceptance (fail the source if any of these miss):**

- Size between 10,000 and 20,000.
- Contains all four ground-truth words: `fiery`, `wrote`, `poise`, **`vetch`**.
- Offline entropy on dictionary words typically ~4–5 guesses. Do not invent a large-n average in README unless this repo actually ran a bench.

---

## 4. Architecture and repo layout

**TypeScript (ESM), Node ≥ 22.18, no build step, no framework, zero runtime deps.**

Verified on the live machine (`node v22.18.0`, `npm 10.9.2`):

- `node src/cli.ts` runs `.ts` **directly** — no `tsx` / `ts-node` / `tsc` emit. Type stripping is on by default from 22.18.
- `node --test` runs `*.test.ts`. No Vitest/Jest.

**Three type-stripping landmines — they crash at runtime:**

1. No `enum`, `namespace`, parameter properties, or `experimentalDecorators`. Use `type Mark = 'absent' | 'present' | 'correct'`.
2. Imports need the **`.ts` extension**: `import { score } from './feedback.ts'` + `"allowImportingTsExtensions": true`.
3. Type-only imports: `import type { … }` (`verbatimModuleSyntax`).

`tsc` is **type-check only**: `npm run typecheck` = `tsc --noEmit`. `devDependencies`: `typescript`, `@types/node`, `word-list`. `dependencies`: **empty**.

```
votee-wordle-solver/
├── package.json
├── tsconfig.json
├── PLAN.md                   # this spec (English). Keep it if the branch already has it.
├── README.md
├── .gitignore                # node_modules, .env — not this PLAN
├── data/
│   ├── words5.txt
│   └── opening.json          # { "word": "tares", "bits": 6.2024 }
├── scripts/
│   └── build-words.ts
├── src/
│   ├── types.ts
│   ├── api.ts
│   ├── feedback.ts
│   ├── filter.ts
│   ├── constraints.ts        # display only
│   ├── strategy.ts
│   ├── solver.ts
│   ├── probe.ts              # dictionary-free fallback
│   ├── words.ts
│   ├── cli.ts
│   └── server.ts             # slice 5: thin UI over the same solve()
├── web/
│   └── index.html            # English, light Wordle colours
└── test/
    ├── unit/
    └── live/
```

Node 22 **does not** accept a directory path for `--test`. Use a glob: `node --test "test/unit/*.test.ts"`.

Scripts:

```
start        : node src/cli.ts
solve:random : node src/cli.ts --mode random
solve:daily  : node src/cli.ts --mode daily
web          : node src/server.ts                    # slice 5
test         : node --test "test/unit/*.test.ts"
test:live    : node --test "test/live/*.test.ts"
typecheck    : tsc --noEmit
build:words  : node scripts/build-words.ts
```

Enable `erasableSyntaxOnly` so `enum` / `namespace` / parameter properties fail at type-check instead of at runtime. `noUncheckedIndexedAccess` is worth it (`word[i]` everywhere).

### Shared types (`src/types.ts`, freeze these)

```ts
type Mark     = 'absent' | 'present' | 'correct'   // no enum
type Feedback = Mark[]        // length = size, index = slot
type Oracle   = (guess: string) => Promise<Feedback>
```

`Feedback` does **not** keep `{slot, guess, result}`. Normalise in `api.ts`. **`api.ts` is the only module that knows Votee's response shape.** Everything else sees `Mark[]`, so the solver tests offline.

---

## 5. Module contracts

### 5.1 `src/api.ts`

| Function | Signature | Notes |
| --- | --- | --- |
| `createWordOracle` | `(target: string) => Oracle` | `GET /word/{target}?guess=…` — reject non `a-z` targets |
| `createRandomOracle` | `(seed: number, size: number) => Oracle` | **seed required** (throw if missing / not a non-negative integer) |
| `createDailyOracle` | `(size: number) => Oracle` | `GET /daily?guess=…&size=…` |

Base URL `https://wordle.votee.dev:8000`, overridable via `VOTEE_BASE_URL`.

- Normalise guess: `trim().toLowerCase()`.
- Build `Feedback` by `item.slot`, **not** array order. Throw if a slot is missing.
- HTTP errors: throw with status + URL + body. Retry **network/5xx only**, max 2, backoff 300ms/900ms. Never retry 4xx.

Verified server validation:

| Case | Result |
| --- | --- |
| `guess.length !== size` | `400` |
| non-letter in guess (`ar1se`) | `400` |
| negative `seed` | `500` ⇒ we only generate positive integers |
| `size` 4 or 6 | OK |
| `/word/{target}` without `size` | OK (length of target) |

### 5.2 `src/feedback.ts`

`score(guess, target)` implements section 2 **exactly**. Local mirror of the server. Also export `patternKey`, `encode`, `isSolved`, `createLocalOracle`.

### 5.3 `src/filter.ts`

`isConsistent` / `filterCandidates`: keep a candidate iff `patternKey(guess, candidate) === encode(feedback)`. One idea: *"if X were the secret, the server would have returned `score(guess, X)`."*

### 5.3b `src/constraints.ts` — display only, never the filter

```ts
type Knowledge = {
  fixed:     (string | null)[]
  required:  Set<string>
  forbidden: Set<string>
  bannedAt:  Set<string>[]
}
```

`correct` → `fixed[i]`; `present` → `required` + `bannedAt[i]`; `absent` → `forbidden`.

With per-slot scoring the two models are logically equivalent, but score-match is a one-line pure function. Constraints print:

```
known: f _ _ _ _   must have: r, e   ruled out: c, a, n   not at: r@1, e@4
```

`solver.ts` must **not** import this file. `cli.ts` does.

### 5.4 `src/strategy.ts`

`pickGuess` is **deterministic**. These helpers must be **named functions** (do not inline): `partitionSizes`, `entropyBits`, `worstCase` (`Math.max` of bucket sizes), `scoreByFrequency`. Three strategies share `partitionSizes`:

- **freq** (pickGuess default if called with no strategy): sum of per-slot counts, maximize, `score * 0.5 ** duplicates`. **Do not** use `Π(maxFreq − freq)` — one maxed slot zeroes the product and you get a pile of ties. That formula is from The Dodgy Engineer; we adapted it. Never name this `bestFreq`.
- **entropy** (`solve` default): Shannon bits, maximize.
- **minimax**: call `worstCase(partitionSizes(...))`, minimize (Knuth 1976). Do not inline `Math.max`.

If `|C| > 300`, skip partitioning and use `freq`. If `|C| ≤ 30` and `attemptsLeft > 1`, the guess may come from the full dictionary.

Tie-break: prefer a guess still in `candidates`, then alphabetical.

Opening word: **not** Wordle's `soare`. On this dictionary **`tares` is 6.2024 bits** (`data/opening.json`).

Default **entropy**. `freq` is the cheap fallback above 300 candidates. Qualitative: dictionary words typically finish in about four to five guesses; probe is slower but always finishes. Some six-guess misses are families that differ by one slot (e.g. `doves` / `doges` / `doses`) — a budget limit, not a search bug; probe still finishes them.

### 5.5 `src/words.ts`

`loadWords(5)` reads `data/words5.txt`. `loadOpening()` reads `data/opening.json` or returns `undefined`. CLI: `loadOpening() ?? 'tares'`.

### 5.6 `src/solver.ts`

Oracle-agnostic loop. `maxAttempts` 6 for the dictionary phase. No `console.log` (use `onProgress`).

If candidates empty and `fallback === false` → `DictionaryGapError`. If `fallback === true` (default) → `resolveByProbing`.

### 5.7 `src/probe.ts`

Per-slot scoring means one guess is five letter tests. Track `fixed`, `absent`, `bannedAt`, `floating`. `deduce()`: a present letter with only one legal slot is placed immediately. Reuse settled slots to park untested letters. Cap 40. Optional all-green confirmation submit.

A missing dictionary word to demo: **`zzzzz`** or **seed=38 → `agnew`**. `votee` is optional.

### 5.8 `src/cli.ts`

`node:util` `parseArgs`. Modes: `random | daily | word | offline`. Print the seed. ANSI colours, no `chalk`. Exit 0 / 1 / 2. The CLI does not import `probe.ts`; the solver does.

### 5.9 `src/server.ts` + `web/index.html` (slice 5)

`node:http`. `GET /api/solve?mode=&strategy=&seed=&target=` returns JSON `{ ...solve result, seed, dictionarySize }`. Serve `web/index.html` at `/`. Same `solve()` as the CLI — no algorithm in the browser. Light Wordle colours. Numbered fields. Hide seed unless `/random`, hide target unless `/word`. English copy. No dark dashboard. No invented bench numbers in the UI.

---

## 6. Tests

All logic tests **offline**. Live tests opt-in (`npm run test:live`) so a dead network does not fail `npm test`.

### 6.1 `feedback.test.ts` — live API pairs, hardcoded

| target | guess | expected |
| --- | --- | --- |
| `apple` | `apple` | `ccccc` |
| `apple` | `zzzzz` | `aaaaa` |
| `apple` | `arise` | `caaac` |
| `apple` | `allee` | `cpppc` |
| `apple` | `eeeee` | `ppppc` |
| `apple` | `pppaa` | `pccpp` |
| `apple` | `pzzzp` | `paaap` |
| `tests` | `tooot` | `caaap` |
| `tests` | `ttttt` | `cppcp` |
| `teyyy` | `ttttt` | `cpppp` |

### 6.2–6.4

Filter: the true target always survives; `absent` drops that letter everywhere; all-correct leaves one word. Strategy: deterministic; one candidate returns it; freq penalises repeats. Solver: local oracle solves `apple` / `fiery`. Probe: `zzzzz` still solves; `fallback: false` on a missing word throws `DictionaryGapError`.

### 6.5 `test/live/api.test.ts`

Slice 3:

- Contract: local `score()` matches live `/word` on the table above.
- `/random?seed=1` twice → identical; solve → `fiery`.
- `/random` without seed, several fetches → more than one secret (raw `fetch`; the oracle forbids a missing seed).

Slice 4 **add**: seed=38 → `agnew` and history has `phase === 'probe'`. Optional: `/daily` solves (do not assert the word).

---

## 7. Build order (how the modules landed)

Ship a working demo early. Each slice is a committable state.

| Slice | What | Done when |
| --- | --- | --- |
| 1 | types, scorer, filter, unit tests | `apple`+`allee` = `cpppc`, `npm test` green |
| 2 | strategy, words, solver (probe comes next) | offline `apple`; `data/words5.txt` exists |
| 3 | HTTP + CLI | `--target apple`, `--seed 1` → `fiery` |
| 4 | `probe.ts` + wire solver | non-dictionary demo: `zzzzz` or seed=38 → `agnew` |
| 5 | thin English UI over the same `solve()` | `npm run web`; unused fields hidden |
| 6 | README + credits | no invented bench numbers |

---

## 8. Risks

| Risk | Handling |
| --- | --- |
| Secret not in our dictionary | Probe (default). `DictionaryGapError` only when fallback is off |
| Forgot to pin `seed` | Random oracle throws; CLI generates and prints |
| Copy The Dodgy Engineer's product-of-gaps formula | It collapses on ties. Sum and maximise (section 5.4) |
| Standard Wordle duplicate handling | Wrong vs this API (`cpppc` not `capac`) |
| Network dies mid-session | Unit tests offline; retry 5xx only |
| `size` ≠ 5 | API layer OK; dictionary is size 5 only → throw clearly |
| Port 3000 already in use | Print how to kill the old process; do not dump a stack trace |

---

## 9. README outline (the email grades this too)

1. What it does + a sample run.
2. Quick start (`npm test`, `npm start -- --mode word --target apple`, `npm run web` if it exists).
3. How the Votee API works (three endpoints, one oracle).
4. Finding 1: `/random` is stateless — pin a seed.
5. Finding 2: per-slot scoring, not Wordle.
6. Finding 3: dictionary is ours; secrets miss the list; probe is the way out.
7. Architecture (oracle / solver split).
8. Algorithm (filter, entropy / minimax / freq, `tares`).
9. Results — only numbers measured in this session (or say so).
10. Testing (offline vs live).
11. References: Shannon 1948, Knuth 1976, 3Blue1Brown, The Dodgy Engineer (**adapted**), NYT tips as background, word-list / SCOWL.
12. Limitations. UI section only if `web/` exists.

---

## 10. Definition of done

- [ ] `npm test` green, no network.
- [ ] `npm run test:live` green, including the `score()` contract.
- [ ] `--mode random` without `--seed` prints a seed and solves.
- [ ] `--mode daily` solves.
- [ ] `--mode word --target apple` and `--target zzzzz` solve.
- [ ] `--mode random --seed 1` → `fiery`; `--seed 38` → `agnew`.
- [ ] `npm run typecheck` clean; no `enum`; empty runtime `dependencies`.
- [ ] `constraints.ts` is not imported by `solver.ts`.
- [ ] README has the findings and references. No invented large-n bench unless this repo ran one.
- [ ] You can explain each file in two sentences.

---

## Appendix A — Verified API log (live, 2026-08-14)

Base: `https://wordle.votee.dev:8000` · spec from `/openapi.json` (FastAPI 0.1.0).
`GuessResult = {slot, guess, result}`; all three endpoints return `GuessResult[]`.

```
# Scoring: per-slot predictions matched 5/5
/word/tests?guess=ttttt  → cppcp     (Wordle: caaca)
/word/apple?guess=eeeee  → ppppc     (Wordle: aaaac)
/word/apple?guess=pppaa  → pccpp
/word/apple?guess=zzzzz  → aaaaa
/word/apple?guess=pzzzp  → paaap
/word/tests?guess=tooot  → caaap
/word/teyyy?guess=ttttt  → cpppp
/word/apple?guess=allee  → cpppc     (Wordle: capac)
/word/apple?guess=apple  → ccccc
/word/apple?guess=ARISE  → caaac     (uppercase accepted, echoed lower)

# /random without seed is a different secret each request
/random?guess=arise&size=5          → present, present, absent, absent, absent
/random?guess=arise&size=5          → absent, correct, absent, absent, absent

# with seed it is deterministic
/random?guess=arise&size=5&seed=1   → absent, present, present, absent, present
/random?guess=arise&size=5&seed=1   → absent, present, present, absent, present

# ground truth via 26× aaaaa..zzzzz
seed=1 → fiery    seed=42 → wrote    seed=777 → poise    daily(2026-08-14) → vetch
seed=38 → agnew   (not in word-list)

# validation
guess.length !== size        → 400
non-letter in guess          → 400
negative seed                → 500
size = 4 or 6                → OK
/word/{target} without size  → OK
```

## Appendix B — Out of scope

Three-dropdown "API browser" · React/Next · a build step (`dist/`, esbuild, vite) · `tsx`/`ts-node` · Vitest/Jest · `chalk`/`yargs`/`axios`/`commander`/`lodash` · `enum`/`namespace`/decorators · `any` · DI containers · an LLM inside the solver · Docker · hardcoding `seed` inside the solver · hardcoding `soare` · copying The Dodgy Engineer's product-of-gaps formula · using the constraint model as the filter · inventing bench numbers this repo did not measure · a dark GitHub-style dashboard.
