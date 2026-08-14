# Votee Wordle Solver

Solves the [Votee Wordle-like API](https://wordle.votee.dev:8000/redoc) automatically. Point it at a
puzzle, and it infers the hidden word from per-guess feedback — typically in 4 guesses.

TypeScript on Node 22 with **zero runtime dependencies and no build step**.

```
$ npm run solve:random

Votee Wordle Solver
mode=random  size=5  seed=785709  strategy=entropy
dictionary: 12,578 words

#1   T  A  R  E  S   tares
     known: _ _ _ _ _   must have: a,r   ruled out: e,s,t   not at: a@1, r@2
     candidates remaining: 243

#2   G  R  A  I  L   grail
     known: _ r a _ _   must have: a,r   ruled out: e,g,i,l,s,t
     candidates remaining: 35

#3   B  R  A  C  K   brack
     known: _ r a _ _   must have: a,r   ruled out: b,c,e,g,i,k,l,s,t
     candidates remaining: 8

#4   A  M  E  N  D   amend
     known: _ r a _ d   must have: a,r   ruled out: b,c,e,g,i,k,l,m,n,s,t   not at: a@0
     candidates remaining: 1

#5   F  R  A  U  D   fraud

SOLVED  "fraud"  in 5 guesses  (1.1s)
```

## Every guess goes to the Votee API

All three documented endpoints are used, and nothing else plays the puzzle:

| Endpoint | Used by | Verified by |
| --- | --- | --- |
| `GET /random` | `npm run solve:random`, web UI | `test/live/api.test.ts` solves seeds 1, 42, 777 end to end |
| `GET /daily` | `npm run solve:daily`, web UI | `test/live/api.test.ts` solves today's puzzle |
| `GET /word/{word}` | `npm start -- --mode word`, web UI | ten-case contract test against the live API |

A local scorer mirrors the API's rule so the algorithm can be unit-tested and benchmarked without
issuing thousands of requests — benchmarking 1000 games would otherwise take about 4,200 calls and
15 minutes of hammering the server. The contract test exists precisely so that shortcut stays honest:
it replays all ten cases against the real API and fails if the local model ever disagrees.

## Quick start

Requires **Node ≥ 22.18** (runs `.ts` files natively — no `tsc`, `tsx`, or bundler involved).

```bash
npm install          # devDependencies only; the solver itself needs nothing at runtime

npm run solve:random # hidden word chosen by the server
npm run solve:daily  # today's puzzle
npm start -- --mode word --target apple   # controlled test: we pick the answer

npm run web          # browser UI on http://localhost:3000

npm test             # 29 tests, no network needed
npm run test:live    # 7 integration tests against the real API
npm run typecheck    # tsc --noEmit
npm run bench        # measure solve rate and average guesses
```

### Browser UI

`npm run web` starts a ~70-line `node:http` server that serves `web/index.html` and exposes two
endpoints. It is a thin layer over the same solver the CLI uses, so there is no second copy of the
algorithm to keep in sync:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/solve?mode=&seed=&target=&strategy=` | Runs a full solve, returns the guess history |
| `GET /api/guess?mode=&guess=&target=&seed=` | Forwards a single guess, returns raw feedback |

The page picks a puzzle, a strategy, and an optional seed, then reveals each guess as the candidate
set narrows. Opening it through a separate static server such as VS Code Live Server also works — the
API responses allow any origin, and the page falls back to `http://localhost:3000` when it is not
served from that port.

### CLI options

| Flag | Values | Default | Notes |
| --- | --- | --- | --- |
| `--mode` | `random`, `daily`, `word`, `offline`, `bench` | `random` | `offline` uses the local scorer, no network |
| `--target` | any word | — | required for `word` and `offline` |
| `--seed` | positive integer | random, printed | see [Finding 1](#finding-1-random-is-stateless-and-needs-a-pinned-seed) |
| `--strategy` | `entropy`, `minimax`, `freq` | `entropy` | see [Guess selection](#guess-selection) |
| `--size` | integer | `5` | dictionary currently only ships size 5 |
| `--attempts` | integer | `6` | the API imposes no limit; 6 mirrors real Wordle |
| `--partition` | integer | `300` | max candidates before falling back to `freq` |
| `--count` | integer | `300` | benchmark sample size |

## How the API works

All three endpoints share one shape — `(guess, size) → GuessResult[]`, where each result is
`{slot, guess, result}` and `result` is one of `absent`, `present`, `correct`. They differ only in
**who holds the secret word**:

| Endpoint | Secret held by | Role here |
| --- | --- | --- |
| `GET /word/{word}?guess=` | us | Test oracle. We know the answer, so it verifies the solver |
| `GET /random?guess=&size=&seed=` | server, hidden | The actual task |
| `GET /daily?guess=&size=` | server, hidden, fixed per day | A second real puzzle |

Because they are interchangeable, the solver takes an `Oracle` — `(guess) => Promise<Feedback>` — and
never learns which endpoint it is talking to. One algorithm covers all three modes, which is also why
the whole solver is testable offline.

Observed validation behaviour:

| Request | Response |
| --- | --- |
| `guess.length !== size` | `400 Bad Request` |
| guess contains a non-letter (`ar1se`) | `400 Bad Request` |
| negative `seed` | `500 Internal Server Error` |
| `size` of 4 or 6 | works |
| uppercase guess | accepted, echoed back lowercase |
| `/word/{target}` without `size` | works, inferred from target length |

## Finding 1: `/random` is stateless and needs a pinned seed

The API keeps no session. For `/random`, **omitting `seed` means every request is a different secret
word**:

```
GET /random?guess=arise&size=5   → a=present r=present i=absent s=absent e=absent
GET /random?guess=arise&size=5   → a=absent   r=correct i=absent s=absent e=absent
```

Those two responses cannot come from the same word. A solver that ignores this never converges, and
the reason is invisible from the outside — it just looks like the algorithm is broken.

With a seed, behaviour is fully deterministic (same seed and guess always give the same feedback). So
`--mode random` generates **one** positive integer seed at startup, prints it, and reuses it for
every guess in the session. The word is still chosen by the server and unknown to us, so the task is
unchanged — but now it is well-posed and reproducible. `createRandomOracle` requires a seed and
throws without one, so the pitfall cannot be reintroduced by accident.

## Finding 2: scoring is per-slot, not standard Wordle

Each slot is judged **independently**. There is none of Wordle's allocation of duplicate letters:

```
for each position i:
  if   guess[i] === target[i]    → correct
  elif target.includes(guess[i]) → present
  else                           → absent
```

This was derived from black-box probing and then confirmed on ten cases, including the ones where the
two rule sets disagree:

| Target | Guess | Votee API | Standard Wordle |
| --- | --- | --- | --- |
| `apple` | `allee` | `c p p p c` | `c a p a c` |
| `apple` | `eeeee` | `p p p p c` | `a a a a c` |
| `tests` | `ttttt` | `c p p c p` | `c a a c a` |

Three consequences the implementation depends on:

1. `absent` means the letter occurs **nowhere** in the target — stronger than in Wordle. A letter can
   never be `correct` in one slot and `absent` in another.
2. `present` carries **no count information**. You cannot infer "the target has at least two e's",
   so the usual min/max letter-count constraints would be wrong here.
3. Repeating a letter in a guess is nearly pure waste, so the frequency heuristic penalises it.

`src/feedback.ts` mirrors this rule locally, which is what makes offline benchmarking possible. A
contract test in `test/live/api.test.ts` replays all ten cases against the live API and asserts the
local model still agrees — so if Votee ever changes the rule, a test fails instead of the solver
quietly degrading.

## Finding 3: the per-slot rule leaks the answer in 26 guesses

Because slots are independent, guessing `aaaaa`, `bbbbb`, …, `zzzzz` reveals the word outright: every
`correct` marks exactly which slot holds that letter. Twenty-six requests, no dictionary required.

This is how the ground-truth values in the test suite were obtained: `seed=1 → fiery`,
`seed=42 → wrote`, `seed=777 → poise`, and the daily word on 2026-08-14 → `vetch`.

The solver deliberately does **not** use it. The task is to infer the word, and inference does it in
about 4 guesses rather than 26. It is reported here because it is a genuine property of the scoring
rule, and because those recovered words make excellent test fixtures.

## Architecture

```
                    ┌── createWordOracle(target)  → /word/{target}
solve({ oracle }) ──┼── createRandomOracle(seed)  → /random?seed=…
                    └── createDailyOracle()       → /daily
                    └── createLocalOracle(target) → local, no network (benchmark + tests)
```

| File | Responsibility |
| --- | --- |
| `src/types.ts` | `Mark`, `Feedback`, `Oracle`, `SolveResult` |
| `src/api.ts` | The only place that knows Votee's response shape. Normalises to `Mark[]`, retries 5xx |
| `src/feedback.ts` | The scoring rule (Finding 2), plus the local oracle |
| `src/filter.ts` | Narrows the candidate set |
| `src/strategy.ts` | Chooses the next guess |
| `src/solver.ts` | The game loop. Knows nothing about HTTP, prints nothing |
| `src/constraints.ts` | Derives human-readable knowledge — **for display only** |
| `src/words.ts` | Loads the dictionary and the cached opening word |
| `src/bench.ts` | Runs many games offline, returns numbers without printing |
| `src/cli.ts` | Argument parsing and rendering |
| `src/server.ts` | Optional HTTP layer for the browser UI |

`api.ts` converts `{slot, guess, result}[]` into a positional `Mark[]` immediately, keyed by `slot`
rather than array order, and throws if any slot is missing. Everything inland deals only in `Mark[]`.

`solver.ts` never calls `console.log`; callers pass an `onProgress` callback. That keeps tests silent
and leaves all formatting in one place.

## Algorithm

### Candidate filtering

If candidate *X* were the secret word, the server would have had to return `score(guess, X)`. It
returned `feedback`. So *X* is still possible exactly when `score(guess, X) === feedback`.

That is the whole filter. It cannot drift away from the server's behaviour the way a hand-written set
of rules could, because it *is* the server's rule.

### Constraints, for narration only

`constraints.ts` accumulates explicit knowledge — `fixed` slots, `required` letters, `forbidden`
letters, and per-slot `bannedAt` sets — and renders lines like:

```
known: _ r a _ d   must have: a,r   ruled out: b,c,e,g,i,k,l,m,n,s,t   not at: a@0
```

Under the per-slot rule this is *logically equivalent* to pattern matching: each mark maps one-to-one
onto a constraint, with nothing lost. `test/unit/constraints.test.ts` proves it, asserting both
approaches return identical candidate sets over 200 deterministic `(target, guess)` pairs and across
multi-turn accumulation.

Given equivalence, the choice is about maintenance: pattern matching is a pure function, while the
constraint model is four mutable structures carried across turns. So filtering uses the function and
narration uses the structures. `solver.ts` does not import `constraints.ts` at all.

### Guess selection

Any guess **partitions** the remaining candidates by the feedback pattern each would produce. The
server's answer picks one partition, and that partition becomes the new candidate set. Three ways to
score a guess, all sharing that partition step:

| Strategy | Rule | Optimises |
| --- | --- | --- |
| `entropy` | maximise `Σ −p·log₂p` | average information gained (default) |
| `minimax` | minimise the largest partition | worst case |
| `freq` | maximise positional letter frequency, penalising repeats | nothing directly — it is a proxy |

Ties prefer a guess that is itself still a candidate, then fall back to alphabetical order, so results
never depend on input ordering.

Partitioning costs `O(|G|·|C|·n)`, so above 300 remaining candidates the solver drops to `freq`.
Raising that limit to 2000 was measured and did **not** help (4.20 vs 4.17 average) while doubling
runtime, so 300 stayed.

Two refinements matter more than they look:

- **Cached opening.** `scripts/best-opening.ts` computes the highest-entropy first guess over the full
  dictionary and writes `data/opening.json`. The answer is **`tares` at 6.2024 bits**, ahead of
  `lares` (6.1560) and `rales` (6.1206). It is computed, not copied from a blog post — and under the
  per-slot rule it beats `soare`, the usual optimum for standard Wordle, which lands 7th here.
  Encoding patterns as base-3 integers counted in a typed array makes the full 12,578² sweep run in
  3 seconds.
- **Probe guesses.** With few candidates that differ in only one slot — `doges`, `doles`, `domes`,
  `dopes`, `doses`, `dotes`, `doves`, `dozes` — guessing inside the set eliminates one word per turn
  and runs out the clock. When 30 or fewer candidates remain and at least two guesses are left, the
  pool widens to the whole dictionary so a word that *cannot* be the answer can still split several
  candidates at once. Step 4 of the `fraud` run above (`amend`) is exactly this.

## Results

Measured on this dictionary with the cached opening, 6-guess limit, sampled evenly and
deterministically so runs are comparable. Reproduce with `npm run bench -- --strategy <name>`.

| Strategy | Sample | Solved | Average guesses | Time |
| --- | --- | --- | --- | --- |
| `entropy` | 1000 | **99.0%** | **4.22** | 39.7s |
| `entropy` | 300 | 99.3% | 4.18 | 10.9s |
| `minimax` | 300 | 99.7% | 4.29 | 12.4s |
| `freq` | 300 | 90.7% | 4.28 | 0.6s |

Distribution over the 1000-word sample:

| Guesses | 1 | 2 | 3 | 4 | 5 | 6 | failed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Words | 0 | 12 | 137 | 527 | 253 | 61 | 10 |

`freq` costs 20× less time but fails nine times as often, which is why `entropy` is the default and
`freq` is kept only as the large-candidate fallback and as a baseline to compare against.

Every one of the ten failures is a same-frame family where candidates differ in a single slot:
`cases`, `doves`, `epees`, `gills`, `gyves`, `nines`, `pined`, `sagos`, `saris`, `sazes`. With
`doves`, for instance, no single word separates `doves`/`doges`/`doses`/`dozes`/`dotes` — the
distinguishing letters `v`/`g`/`s`/`z`/`t` cannot all appear in one five-letter guess. This is
inherent to a 6-guess budget, not a defect in the search.

## Complexity

With `n = 5` and `|C|` remaining candidates:

| Operation | Cost |
| --- | --- |
| `score` / `patternKey` | `O(n²)` — `includes` scans the target; constant in practice |
| Filtering candidates | `O(|C|·n²)` |
| `freq` selection | `O(|C|·n)` |
| `entropy` / `minimax` selection | `O(|G|·|C|·n²)`, capped at `|C| ≤ 300` |
| Opening word sweep (dev-only) | `O(|D|²·n)`, 3s for 12,578 words via base-3 encoding |

## Testing

`npm test` runs 29 tests and needs no network, so it stays green even if the API is unreachable. The
scoring tests use the exact request/response pairs captured from the live API rather than invented
examples.

`npm run test:live` runs 7 integration tests: the ten-case contract test, seed determinism, the
unseeded-drift behaviour from Finding 1, end-to-end solves of `/random` seeds 1, 42 and 777 (asserting
`seed=1` yields `fiery`), an end-to-end `/daily` solve, and the `400` on a wrong-length guess.

## Dictionary

Secret words come from a full English word list, not Wordle's 2,315-answer list — `vetch` is a valid
guess in Wordle but never an answer, and it appeared as a daily target here. `scripts/build-words.ts`
filters [`word-list`](https://github.com/sindresorhus/word-list) down to **12,578** five-letter words
and writes `data/words5.txt`, which is committed so the solver has no runtime dependency. The script
fails loudly if the result falls outside 10,000–20,000 words or omits any known ground-truth answer.

## Attribution

- Dictionary: [`word-list`](https://github.com/sindresorhus/word-list) (MIT) by Sindre Sorhus, derived
  from [SCOWL](http://wordlist.aspell.net/) by Kevin Atkinson.
- Positional letter-frequency idea: **The Dodgy Engineer** on YouTube. Adapted, not copied: the
  original scores `Π(maxFreq − freq)` and minimises, which collapses to zero whenever any slot hits
  `maxFreq`, leaving many words tied and the choice effectively arbitrary. This implementation sums
  positional frequencies and maximises instead.
- Entropy framing: **3Blue1Brown**'s information-theory treatment of Wordle.
- Opening-word and letter-spread heuristics: [NYT, *Best Wordle Tips*](https://www.nytimes.com/2022/02/10/crosswords/best-wordle-tips.html).
- All API findings above are original black-box observations, reproducible via `npm run test:live`.
- AI assistance was used while writing this code. The API investigation, the design decisions, and
  the measured comparisons are documented here so each can be checked independently.

## Limitations and possible improvements

- Only size 5 ships a dictionary. The API layer handles other sizes; `words.ts` throws a clear error
  until a matching list is generated.
- Guess selection is greedy — one level deep. A two-step lookahead would help precisely the
  same-frame families that account for every failure, at a large cost in compute.
- `entropy` optimises average information, so it is not tuned for the 6-guess deadline specifically. A
  hybrid that switches to `minimax` when few guesses remain is untested but plausible.
- The dictionary is broader than the API's own target list, which likely makes the benchmark
  pessimistic: all four recovered ground-truth words are more common than entries like `sazes` or
  `barps` that the benchmark is full of.
- No rate-limit handling beyond 5xx retries, since no throttling was observed.
