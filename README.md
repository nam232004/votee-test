# Votee Wordle Solver

Solves the [Votee Wordle-like API](https://wordle.votee.dev:8000/redoc) automatically. Point it at a
puzzle, and it infers the hidden word from per-guess feedback — typically in 4 guesses, and **always**,
even when the answer is not in any dictionary.

TypeScript on Node 22 with **zero runtime dependencies and no build step**.

- [How the API works](#how-the-api-works) — three endpoints, one oracle
- [Finding 1](#finding-1-random-is-stateless-and-needs-a-pinned-seed) — `/random` needs a pinned seed
- [Finding 2](#finding-2-scoring-is-per-slot-not-standard-wordle) — scoring is not standard Wordle
- [Finding 3](#finding-3-the-secret-word-is-often-not-a-dictionary-word) — secrets are often not dictionary words
- [Finding 4](#finding-4-the-per-slot-rule-guarantees-a-way-out) — a dictionary-free fallback
- [Algorithm](#algorithm) — filtering, then `freq` / `entropy` / `minimax`
- [Results](#results) — 60/60 live, 99.0% inference
- [References](#references) — every borrowed idea, with a source

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

npm test             # 41 tests, no network needed
npm run test:live    # 8 integration tests against the real API
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
| `--attempts` | integer | `6` | budget for the inference phase; probing continues past it |
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

## Finding 3: the secret word is often not a dictionary word

Solving `/random` seeds 1–60 revealed that **9 of them are outside any reasonable word list**:

```
agnew  xhosa  aruba  rabin  thule  somal  della    ← proper nouns
wasnt                                              ← contraction, apostrophe stripped
fecal
```

Votee draws targets from a source that includes people, places and peoples. `word-list` excludes
proper nouns by design; swapping in the much broader
[`dwyl/english-words`](https://github.com/dwyl/english-words) covers 6 of the 9 but still misses
`agnew`, `xhosa` and `aruba`. That is the point: **no dictionary can be relied on to cover the
target**, so dictionary coverage cannot be part of the correctness argument.

The task is to find the word, not to defend a word list. So the dictionary is treated as a fast path,
with a guaranteed fallback behind it.

## Finding 4: the per-slot rule guarantees a way out

Because slots are judged independently, one guess is really **five independent experiments**: put a
different letter in each unresolved slot and every slot answers about its own letter. Each answer
removes something permanently:

| Response at slot *i* | What it proves |
| --- | --- |
| `correct` | slot *i* is settled forever |
| `absent` | that letter is in **no** slot — eliminated everywhere at once |
| `present` | not at *i*, but somewhere — so try it at the other slots first |

Iterating that resolves any word with **no dictionary at all**, and it must terminate: each guess
either settles a slot or shrinks a slot's letter pool. This is also how the test fixtures were
obtained (`seed=1 → fiery`, `seed=42 → wrote`, `seed=777 → poise`, daily on 2026-08-14 → `vetch`).

Combining Findings 3 and 4 gives the solver its two phases, in `src/solver.ts`:

1. **Inference** — dictionary + entropy. Solves 4 out of 5 puzzles in about 4 guesses.
2. **Probing** — `src/probe.ts`, entered when the candidate set empties or the guess budget runs out.
   Slower, but cannot fail.

Two details keep probing cheap — together they took `seed=38` from 15 guesses down to 9:

- **It inherits what inference learned**, so it never re-tests a letter earlier guesses ruled out.
- **Settled slots get reused as membership tests.** Re-typing a known letter only earns another
  `correct`, which teaches nothing. Putting an unclassified letter there instead turns the slot into a
  free experiment: `absent` kills that letter everywhere, `present` proves it belongs to one of the
  remaining slots. Without this, the last unresolved slot is tested one letter per guess — the reason
  `agnew` originally spent ten guesses hunting a single `w`.

The final probe re-submits the assembled word, so the answer is confirmed by the API rather than
merely deduced. Since the API imposes no guess limit, all of this costs only time.

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
| `src/probe.ts` | Dictionary-free fallback (Finding 4) — guaranteed to resolve any word |
| `src/solver.ts` | The two-phase game loop. Knows nothing about HTTP, prints nothing |
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

Two phases, one loop. Phase 1 is the interesting one: it treats the puzzle as a
search over a dictionary. Phase 2 is a guaranteed fallback that needs no dictionary
at all (Finding 4). Every guess in both phases is sent to the live Votee API.

```
candidates ← the 12,578-word dictionary
for attempt in 1..6:                                          # inference
    guess    ← pickGuess(candidates)                          # src/strategy.ts
    feedback ← oracle(guess)                                  # one HTTP request
    if every slot is correct: return guess
    candidates ← { w ∈ candidates | score(guess, w) = feedback }
    if candidates is empty: break                             # secret is not in the list
if still unsolved:
    resolve the remaining slots letter by letter              # src/probe.ts
```

`pickGuess` is where the three strategies live. The rest of this section explains
that choice. Filtering itself is a one-liner, covered first because the strategies
are just different ways of *predicting* how well a guess will filter.

Sources for each idea are listed in [References](#references). Inline citations
point there; nothing is used without saying where it came from, and nothing is
copied without saying how it was changed.

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

#### Partitioning: the one idea all three strategies share

Take a guess and the current candidate set. For **each** candidate, ask what feedback the server would
return *if that candidate were the answer*, and group candidates that would produce the same string.

Guessing `tares` against the full dictionary splits 12,578 words into **211 groups, the largest holding
830 words**. The server's reply reveals which group we are in, and that group *becomes* the new
candidate set. So a good guess is one that splits finely.

```ts
function partitionSizes(guess: string, candidates: string[]): number[] {
  const buckets = new Map<string, number>();
  for (const candidate of candidates) {
    const key = patternKey(guess, candidate);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.values()];
}
```

This returns something like `[830, 512, 401, …]`. **The three strategies differ only in how they score
that array of numbers.**

#### `freq` — positional letter frequency

No partitioning at all. Count, for each slot, how many candidates have each letter there; a word's
score is the **sum** of its letters' frequencies at their own slots, halved once per repeated letter.
Highest score wins.

```ts
score += frequency[i]!.get(word[i]!) ?? 0;
const duplicates = size - new Set(word).size;
scores.set(word, score * 0.5 ** duplicates);
```

Repeats are penalised because the per-slot rule (Finding 2) means `present` carries no count
information: guessing `eeeee` does not reveal "the target has two e's", it just re-asks one question.

Being a proxy, it is measurably imperfect. At turn one it prefers `cares` over `tares`:

| Word | `freq` score | Actual entropy |
| --- | --- | --- |
| `cares` | **10,335** ← chosen | 5.9679 bits |
| `bares` | 10,323 | 5.8677 bits |
| `pares` | 10,258 | 5.9695 bits |
| `tares` | 10,227 | **6.2024 bits** ← actually the best |

It ranks `cares` first, yet `tares` extracts more information. `freq` never looks at how the candidate
set actually splits — that is precisely what makes it cheap, and what makes it wrong sometimes.

The idea of scoring words by how common their letters are *in each slot* comes from
[The Dodgy Engineer (2022)](#references). The formula used here is **not** the one in
that video — see [References](#references) for the departure and why.

#### `entropy` — maximise expected information (default)

With group sizes `n₁, n₂, …` summing to `N`, let `pᵢ = nᵢ / N` and maximise Shannon's
entropy ([Shannon 1948](#references)):

```
H = Σ −pᵢ · log₂ pᵢ        bits
```

One bit halves the search space, so `tares` at 6.2024 bits divides 12,578 by roughly `2^6.2 ≈ 74` on
average. `−log₂ p` is the surprise of an outcome; `H` is expected surprise, and it peaks when the
groups are **equal** — that is, when no group is left bloated. Applying this specifically to Wordle
follows [Sanderson / 3Blue1Brown (2022)](#references).

#### `minimax` — make the worst case as good as possible

Ignore the average; minimise the largest group.

```
W = max(n₁, n₂, …)
```

"Minimise the maximum": assume the unluckiest reply, then choose the guess that makes it least bad.
This is Knuth's technique for Mastermind ([Knuth 1976](#references)) applied to a five-letter alphabet.

#### Where entropy and minimax actually disagree

A real state, from solving `aahed`, turn 5, 15 candidates remaining:

```
aahed, baaed, baked, bayed, dazed, eaved, faked, faxed,
fayed, fazed, gaged, gazed, hayed, hazed, oaked
```

| Strategy | Picks | Entropy | Largest group | Groups |
| --- | --- | --- | --- | --- |
| `entropy` | `hazed` | **1.688 bits** | 9 | 5 |
| `minimax` | `fazed` | 1.673 bits | **8** | 4 |

The trade-off in one table: `hazed` learns more on average but accepts a worse worst case; `fazed`
gives up a little average gain to cap the damage at 8. Neither is "correct" — they optimise different
things. Another instance, solving `araks` at turn 3 with 26 candidates: `entropy` picks `draps`
(largest group 14), `minimax` picks `craps` (largest group 12).

#### Determinism and the cost ceiling

Ties prefer a guess that is itself still a candidate — it keeps the chance of winning this turn, which
a non-candidate cannot — and then fall back to alphabetical order. Knuth's original formulation makes
the same choice for the same reason. The alphabetical step makes results independent of input
ordering, so benchmarks are reproducible and tests do not flake;
`test/unit/strategy.test.ts` asserts it.

Partitioning costs `O(|G|·|C|·n)`, so above 300 remaining candidates the solver drops to `freq`.
Raising that limit to 2000 was measured and did **not** help (4.20 vs 4.17 average) while doubling
runtime, so 300 stayed.

#### Refinement 1: the opening word is computed, not copied

Turn one always faces the same candidate set, so the answer never changes — compute it once and cache
it in `data/opening.json`. `scripts/best-opening.ts` sweeps all 12,578² pairs:

| Word | Entropy | Largest group |
| --- | --- | --- |
| **`tares`** | **6.2024 bits** | 830 |
| `lares` | 6.1560 | 801 |
| `rales` | 6.1206 | 801 |
| `soare` | 6.0684 (7th) | 737 |
| `arise` | 5.7798 | 844 |
| `crane` | 5.3534 | 1,517 |
| `adieu` | 4.9628 | 1,660 |

`soare` is the celebrated optimum for *standard* Wordle, and here it only ranks 7th — because this API
scores per-slot rather than by Wordle's duplicate allocation. Copying an opening from a blog post would
mean optimising for a different game. The [NYT tips article](#references) is why an opening word was
even considered; the numbers in the table come from `npm run build:opening`, not from that article.
`adieu`, widely believed strong for its vowels, is the worst row in the table: 4.96 bits and a worst
group of 1,660 words.

Encoding each pattern as a base-3 integer and counting it in a typed array keeps the full sweep at
**2.7 seconds** instead of allocating 158 million strings.

#### Refinement 2: probe guesses — deliberately guessing a word that cannot win

Nine candidates remain, differing in exactly one slot:

```
doges, doles, domes, dopes, dores, doses, dotes, doves, dozes
```

Guess inside that set, say `doges`: win outright, or else the other eight **all** return `c c a c c`
and stay indistinguishable. One elimination per turn, and the clock runs out.

| Guess | Largest group | Groups | Entropy |
| --- | --- | --- | --- |
| `doges` (a candidate) | 8 | 2 | 0.503 bits |
| `doles` (a candidate) | 8 | 2 | 0.503 bits |
| **`glitz`** (not a candidate) | **5** | **5** | **1.880 bits** |

`glitz` cannot possibly be the answer — it does not even contain `d`, `o`, `e` or `s`. But it carries
`g`, `l`, `t` and `z`, four of the family's distinguishing letters at once, separating `doges` /
`doles` / `dotes` / `dozes` in a single turn: 3.7× the information, for zero chance of winning
immediately.

The pool therefore widens to the whole dictionary when **30 or fewer candidates remain and more than
one guess is left** — the second condition matters, because information bought on the last turn can
never be spent. Step 4 of the `fraud` run above (`amend`) is exactly this. `freq` cannot discover such
guesses at all, since it has no notion of partitioning.

#### The three strategies at a glance

| | `freq` | `entropy` (default) | `minimax` |
| --- | --- | --- | --- |
| Optimises | positional letter frequency | expected information | the worst remaining group |
| Formula | `Σ freq[i][letter] · 0.5^repeats` | `Σ −p·log₂p` | `max(nᵢ)` |
| Direction | maximise | maximise | **minimise** |
| Partitions the set | no | yes | yes |
| Source | [Dodgy Engineer 2022](#references), adapted | [Shannon 1948](#references), [3Blue1Brown 2022](#references) | [Knuth 1976](#references) |
| Solved (sample 300) | 90.7% | 99.3% | 99.7% |
| Average guesses | 4.28 | 4.18 | 4.29 |
| Time for 300 games | 0.6s | 10.9s | 12.4s |
| Role | fallback when \|C\| > 300; baseline | **default** — fastest on average | when failing a game is worse than taking one extra guess |

`entropy` is the default because the task is to find the word quickly. `minimax` solves a *slightly*
higher fraction (99.7% vs 99.3%) at the cost of 0.11 extra guesses on average — the expected
trade-off, since it spends budget protecting the tail. Switch with `--strategy`.

## Results

### Against the live API

`/random`, seeds 1–60, default settings:

| | Count | Average guesses |
| --- | --- | --- |
| **Solved** | **60 / 60 (100%)** | **4.68** |
| solved by inference alone | 51 | 4.12 |
| needed the probe fallback | 9 | 7.9 |

The nine are exactly the out-of-dictionary words from Finding 3. Without the fallback they were
unsolvable; with it they cost about twice as many requests.

### Guess-selection strategies

Measured offline against the local scorer with the cached opening, a 6-guess limit, sampled evenly and
deterministically so runs are comparable. **The probe fallback is disabled here** — with it enabled
every row would read 100% and the comparison would say nothing. These numbers therefore measure the
inference phase alone. Reproduce with `npm run bench -- --strategy <name>`.

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
inherent to a 6-guess budget, not a defect in the search — and in normal operation the probe fallback
finishes these off, which is why the live figure above is 100%.

## Complexity

With `n = 5` and `|C|` remaining candidates:

| Operation | Cost |
| --- | --- |
| `score` / `patternKey` | `O(n²)` — `includes` scans the target; constant in practice |
| Filtering candidates | `O(|C|·n²)` |
| `freq` selection | `O(|C|·n)` |
| `entropy` / `minimax` selection | `O(|G|·|C|·n²)`, capped at `|C| ≤ 300` |
| Opening word sweep (dev-only) | `O(|D|²·n)`, 2.7s for 12,578 words via base-3 encoding |

## Testing

`npm test` runs 41 tests and needs no network, so it stays green even if the API is unreachable. The
scoring tests use the exact request/response pairs captured from the live API rather than invented
examples, and the probe tests use the nine real out-of-dictionary words from Finding 3 plus adversarial
cases (`zzzzz`, `queue`, `aeiou`) that a naive probe gets wrong.

`npm run test:live` runs 8 integration tests: the ten-case contract test, seed determinism, the
unseeded-drift behaviour from Finding 1, end-to-end solves of `/random` seeds 1, 42 and 777 (asserting
`seed=1` yields `fiery`), the out-of-dictionary fallback (`seed=38` → `agnew`), an end-to-end `/daily`
solve, and the `400` on a wrong-length guess.

## Dictionary

Secret words come from a full English word list plus proper nouns, not Wordle's 2,315-answer list —
`vetch` is a valid guess in Wordle but never an answer, and it appeared as a daily target here. Since
no list covers the targets (Finding 3), the dictionary only has to make the *common* case fast;
correctness rests on the probe fallback. `scripts/build-words.ts`
filters [`word-list`](https://github.com/sindresorhus/word-list) down to **12,578** five-letter words
and writes `data/words5.txt`, which is committed so the solver has no runtime dependency. The script
fails loudly if the result falls outside 10,000–20,000 words or omits any known ground-truth answer.

## References

### Algorithms

| Idea | Source | Used here as |
| --- | --- | --- |
| Entropy `H = Σ −p·log₂p` | Claude E. Shannon, [*A Mathematical Theory of Communication*](https://doi.org/10.1002/j.1538-7305.1948.tb01338.x), *Bell System Technical Journal* 27(3), 1948, pp. 379–423 ([PDF](https://archive.org/details/bstj27-3-379)) | `entropy` in `src/strategy.ts` |
| Wordle as an information-theory problem | Grant Sanderson (3Blue1Brown), [*Solving Wordle using information theory*](https://www.3blue1brown.com/lessons/wordle/), Feb 2022 ([video](https://www.youtube.com/watch?v=v68zYyaEmEA)) | Choosing entropy over a hand-rolled heuristic, and reporting in bits |
| Minimax over partition sizes; prefer a still-possible guess on ties | Donald E. Knuth, [*The Computer as Master Mind*](https://janmr.com/refs/knuth-mastermind76/), *Journal of Recreational Mathematics* 9(1), 1976, pp. 1–6 ([PDF](https://ia804602.us.archive.org/10/items/pdfy-4zbExU0jr9Y81AAs/knuth-mastermind_text.pdf)) | `minimax` and the tie-break in `best()` |
| Positional letter-frequency scoring | The Dodgy Engineer, [*Solving Wordle in under 3 guesses with python*](https://wordle.plus/solving-wordle-in-under-3-guesses-with-python/), 23 May 2022 ([channel](https://www.youtube.com/c/TheDodgyEngineer/)). Reached via a NotebookLM summary of the video. | `freq` — **adapted, see below** |
| Opening-word choice and spreading uncommon letters | [NYT, *Best Wordle Tips*](https://www.nytimes.com/2022/02/10/crosswords/best-wordle-tips.html), 10 Feb 2022 | Background only. The opening word here is **computed**, not taken from it |

**Where this implementation deliberately departs from its source.** The positional-frequency video
scores `Π(maxFreq − freq)` and **minimises**. That formula collapses: as soon as any slot reaches
`maxFreq` the whole product becomes 0, so a large set of words tie at zero and the pick becomes
effectively arbitrary. `src/strategy.ts` instead **sums** positional frequencies and maximises, with a
`0.5^duplicates` penalty the original does not have — needed because this API scores per slot, so
repeated letters carry almost no information (Finding 2). The video also reports averaging 2.95 guesses;
that figure is not reproducible here. Measured on *this* dictionary, `freq` averages 4.28 guesses at a
90.7% solve rate.

Likewise, the well-known optimal openers from standard-Wordle write-ups (`soare`, `crane`, `adieu`)
are **not** used. They optimise Wordle's duplicate-allocation rule; under this API's per-slot rule the
computed optimum is `tares`, and `soare` ranks 7th.

### Data

- Dictionary: [`word-list`](https://github.com/sindresorhus/word-list) (MIT) by Sindre Sorhus, derived
  from [SCOWL](http://wordlist.aspell.net/) by Kevin Atkinson.
- Coverage comparison in Finding 3 used [`dwyl/english-words`](https://github.com/dwyl/english-words)
  (`words_alpha.txt`, 15,921 five-letter words) — it covers 6 of the 9 out-of-dictionary targets, and
  is **not** shipped.
- API contract: [Votee Wordle API docs](https://wordle.votee.dev:8000/redoc).

### Original work

- Findings 1–4 are original black-box observations of this API, not documented anywhere upstream.
  Each is reproducible: `npm run test:live` asserts all of them.
- Every number in this README was measured on this machine and can be regenerated with
  `npm run bench`, `npm run build:opening`, or the named test files. None are quoted from a third party.
- AI assistance was used while writing this code. The API investigation, the design decisions and the
  measured comparisons are documented here specifically so each can be checked independently rather
  than taken on trust.

## Limitations and possible improvements

- Only size 5 ships a dictionary. The API layer handles other sizes; `words.ts` throws a clear error
  until a matching list is generated.
- The one genuinely unsolvable input is a `--mode word` target containing something outside `a–z`
  (`ab1cd`). The API rejects guesses with non-letters, so no guess can ever match that slot.
  `createWordOracle` refuses such targets up front rather than probing 26 letters to discover it.
- Guess selection is greedy — one level deep. A two-step lookahead would help precisely the
  same-frame families that account for every failure, at a large cost in compute.
- `entropy` optimises average information, so it is not tuned for the 6-guess deadline specifically. A
  hybrid that switches to `minimax` when few guesses remain is untested but plausible.
- Probing averages 7.9 guesses on out-of-dictionary words. Adding proper nouns to the dictionary would
  reduce how often it is needed at all, and probing still tests letters in alphabetical order — letter
  frequency would find the common ones sooner.
- No rate-limit handling beyond 5xx retries, since no throttling was observed. Probing multiplies
  request count by about three on the words that need it.
