# Votee Wordle Solver

A TypeScript program that **automatically guesses** the Votee Wordle-like puzzle
([API](https://wordle.votee.dev:8000/redoc)). The three endpoints (`/random`, `/daily`,
`/word`) are not three features — they are three oracles with the same signature. One
`solve(oracle)` loop talks to all of them. The brief is `/random`; the other two are the
same algorithm with a different secret-holder.

Requires **Node ≥ 22.18**. TypeScript runs directly (`node src/cli.ts`); no bundler, no
runtime dependencies.

## Quick start

```bash
npm install
npm test                          # unit tests, no network
npm start -- --mode word --target apple
npm run solve:random              # generates a seed and prints it
npm start -- --mode random --seed 1
npm run solve:daily
npm run web                       # http://localhost:3000
npm run test:live                 # hits the real API
```

`--mode offline --target apple` uses the local scorer instead of HTTP.

## How the API works

Every request is independent. You send a `guess`; the server returns
`{ slot, guess, result }[]` with `result` in `absent | present | correct`. There is no
session cookie and no word list from their side.

| Endpoint | Who holds the secret |
| --- | --- |
| `GET /word/{word}?guess=` | We pick it (controlled test) |
| `GET /random?size=&seed=&guess=` | Server, hidden |
| `GET /daily?size=&guess=` | Server, one puzzle per day |

## Findings (verified against the live API)

### 1. `/random` is stateless — pin a seed

Omit `seed` and **every request is a different secret**. Two identical `GET /random?guess=arise`
calls can return incompatible colour patterns. The solver cannot converge.

This CLI generates one non-negative integer at the start of a `random` session, **prints it**,
and reuses it for every guess. `createRandomOracle` throws if the seed is missing or not a
non-negative integer, so the trap cannot ship by accident.

Known pins (from live probing, not from guessing): `seed=1` → `fiery`, `seed=38` → `agnew`.

### 2. Scoring is per-slot, not standard Wordle

For each index `i`:

- `guess[i] === target[i]` → `correct`
- else if `target` contains that letter → `present`
- else → `absent`

There is no Wordle-style duplicate allocator. The decisive pair:

| target | guess | Votee | Wordle |
| --- | --- | --- | --- |
| `apple` | `allee` | **`cpppc`** | `capac` |

Consequences: `absent` means the letter occurs **nowhere**. `present` carries **no count**, so
min/max letter-count constraints from a typical Wordle solver are wrong here. Repeated letters
in a guess are almost wasted (`aaaaa` only asks “does `a` exist, and where?”).

You *could* recover any secret with 26 guesses `aaaaa`…`zzzzz`. That is a semantics check, not
the product: the brief asks for inference, and ~4–5 informed guesses beat 26.

### 3. The dictionary is ours; some secrets are not in it

The API never publishes a valid-word list. This repo filters [`word-list`](https://github.com/sindresorhus/word-list)
(SCOWL, Kevin Atkinson, MIT) down to 12,578 five-letter `a–z` words (`npm run build:words` →
`data/words5.txt`). That list includes `fiery` / `wrote` / `poise` / `vetch`. It does **not**
include proper nouns and nonsense the server still uses (`agnew`, `zzzzz`).

When candidates hit zero, that is not a crash. Phase 2 (`src/probe.ts`) tests unread letters
slot by slot. Because scoring is per-slot, one guess is five letter tests. A present letter
with only one legal home is placed immediately (`deduce`), so we do not spend a junk guess.

## Two-phase solver

1. **Inference** (default 6 guesses). Filter the dictionary with
   `patternKey(guess, candidate) === encode(feedback)`. Opening word **`tares`** (cached in
   `data/opening.json`). Then `pickGuess`: Shannon **entropy** by default; **minimax** (Knuth)
   when you care about the worst remaining bucket; **freq** (sum of per-slot counts, penalise
   repeats) when more than 300 candidates remain — partitioning the full list is too slow.
2. **Probe** if the list empties or the budget runs out. Slower, always finishes.

`src/constraints.ts` is display-only. The solver never filters twice.

## Browser UI

`npm run web` serves `web/index.html`. It calls `GET /api/solve` on the same `solve()` as the
CLI — there is no second algorithm in the page. Seed is shown only for `/random`, target only
for `/word`. History replays as Wordle-coloured tiles.

## Tests

- `npm test` — offline (`node:test`). Includes the 10 live scoring pairs hardcoded, so a
  Wordle allocator would fail on `apple` / `allee`.
- `npm run test:live` — contract against `/word`, `/random` with and without seed, solve
  `seed=1` → `fiery`, `seed=38` → `agnew`.

## Limitations

- Inference is greedy (one ply). Families that differ by a single slot can miss the 6-guess
  dictionary budget; probe still finishes those.
- `freq` is a heuristic, not information-optimal. We adapted it (see references).
- Daily answers change; we do not hard-code today's word.
- No 1,000-game average is claimed here — that measurement was not run in this session.
  On dictionary words, entropy typically lands in about four to five guesses.

## Tools and credit

The hiring mail allows IDEs, chatbots, and LLMs. This repo was written in Cursor. The
algorithm is not copied from another Votee solver. Ideas that came from papers, videos, or
packages are listed below. The dictionary file is generated from an MIT-licensed word list
and committed so a clone can run without that package.

## References

- Votee, [Wordle-like API](https://wordle.votee.dev:8000/redoc) — the puzzle this program solves.
- C. E. Shannon, “A Mathematical Theory of Communication,” *Bell System Technical Journal*, 1948
  (entropy of the feedback partition).
- D. E. Knuth, “The Computer as Master Mind,” *Journal of Recreational Mathematics*, 1976
  (minimax: minimise the size of the largest remaining bucket).
- Grant Sanderson (3Blue1Brown), [“Solving Wordle using information theory”](https://www.3blue1brown.com/lessons/wordle/),
  2022 ([YouTube](https://www.youtube.com/watch?v=v68zYyaEmEA)).
- The Dodgy Engineer, [“Solving Wordle in under 3 guesses with python”](https://wordle.plus/solving-wordle-in-under-3-guesses-with-python/),
  2022 — positional frequency **adapted**. Their product-of-gaps formula collapses (one maxed
  slot zeroes the product and you get a pile of ties). We **sum** per-slot counts and maximise,
  then multiply by `0.5 ** duplicates`.
- New York Times, [“Unwinding Wordle: Tips and Tricks”](https://www.nytimes.com/2024/06/10/crosswords/unwinding-wordle-tips.html)
  — background only; we do not use Wordle’s 2,315-answer list (`vetch` would be missing).
- Sindre Sorhus, [`word-list`](https://github.com/sindresorhus/word-list) (MIT), data from
  [SCOWL](http://wordlist.aspell.net/) by Kevin Atkinson. Runtime reads committed
  `data/words5.txt`; the npm package is a **devDependency** used only by `scripts/build-words.ts`.
