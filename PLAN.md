# PLAN — Votee Wordle Solver (TypeScript, zero build step, zero runtime deps)

> Tài liệu này là **spec để thực thi**, không phải code. Người/model thực thi chỉ cần đọc file này,
> không cần bất kỳ ngữ cảnh nào khác. Mọi phát hiện về API trong đây đều **đã được kiểm chứng bằng
> request thật** (log ở Phụ lục A) — không phải phỏng đoán.
>
> **Plan này đã được dry-run thực tế** trên branch `dry-run`: implement đầy đủ, 29 unit test +
> 7 live test xanh, benchmark 1.000 ván. Mục 0.5 liệt kê những chỗ plan đoán SAI và số đo thay thế.
> Đọc mục đó trước khi bắt tay.

---

## 0. Trả lời câu hỏi thiết kế: 3 API = 3 option hay 1 thuật toán?

**Kết luận: 3 endpoint KHÔNG phải 3 tính năng. Chúng là 3 nguồn cấp cùng một thứ — một `oracle`.**

Cả ba endpoint có **chung một signature và chung một kiểu response**:

```
(guess, size) -> GuessResult[]      // GuessResult = { slot, guess, result: absent|present|correct }
```

Khác biệt duy nhất là *ai giữ từ bí mật*:

| Endpoint | Ai giữ từ bí mật | Vai trò đúng trong bài này |
| --- | --- | --- |
| `GET /word/{word}` | **Ta tự chỉ định** | Test oracle. Biết đáp án ⇒ dùng để verify solver, không phải để "chơi" |
| `GET /random` | Server, ẩn | **Đây chính là đề bài** ("automatically guesses random words") |
| `GET /daily` | Server, ẩn, cố định theo ngày | Một puzzle thật thứ hai để demo |

Vì vậy bản chạy trước (UI + 3 select, mỗi API = 1 option) là **hiểu sai đề**. Nó biến bài thành
"trình duyệt API" trong khi email yêu cầu: *"write a program that **automatically** guesses random
words"*. Chấm điểm sẽ nhìn vào **thuật toán suy luận**, không nhìn vào việc bạn gọi được 3 URL.

Kiến trúc đúng là **một solver duy nhất + một interface oracle có 3 implementation**:

```
                    ┌── wordOracle(target)   → /word/{target}   (dùng cho test)
solver(oracle) ─────┼── randomOracle(seed)   → /random?seed=…   (bài chính)
                    └── dailyOracle()        → /daily
```

Solver **không biết** nó đang nói chuyện với endpoint nào. Đó là điểm bán hàng khi live: bạn nói được
câu *"tôi đã tách oracle ra khỏi solver, nên cùng một thuật toán chạy được cho cả test có đáp án lẫn
puzzle ẩn — và đó là lý do tôi test được thuật toán mà không cần đoán mò"*.

**Anti-goal:** không làm web UI. Deliverable là "zipped Git repo + README" và một buổi live coding.
CLI in ra tiến trình suy luận thuyết phục hơn UI màu mè, và nhẹ hơn nhiều để code trực tiếp.

---

## 0.5 Kết quả dry-run — những gì plan này ĐOÁN SAI

Plan đã được implement đầy đủ và chạy thật. Phần kiến trúc đúng nguyên vẹn; phần **số liệu tôi đoán
thì sai**. Dưới đây là số đo thay thế — dùng số này, đừng dùng số tôi đoán ở các mục sau.

| Plan nói | Thực tế đo được | Hành động |
| --- | --- | --- |
| Strategy mặc định là `freq` (heuristic tần suất) | `freq` chỉ giải được **90,7%** trong 6 lượt | **Mặc định phải là `entropy` (99,0%)**. `freq` chỉ dùng làm fallback khi còn > 300 candidate |
| Benchmark ≥ 99% và ≤ 4,2 lượt | `entropy`: **99,0%**, **4,22 lượt** (mẫu 1.000) | Ngưỡng test: ≥ 97% và ≤ 4,4 lượt (mẫu 150) |
| minimax là "điểm cộng lớn nhất" | minimax **99,7%** nhưng **4,29 lượt** — kém entropy về số lượt | Làm cả ba, mặc định `entropy`. Minimax vẫn đáng nói vì nó đảm bảo worst case |
| Nới ngưỡng phân hoạch sẽ tốt hơn | Nới lên 2000: **4,20 vs 4,17** — không cải thiện, chậm gấp đôi | Giữ 300. Đây là ví dụ tốt về "đo trước khi tối ưu" |
| Opening word quan trọng, cần cache | `tares` (6,2024 bits) chỉ hơn `cares` của heuristic **0,01 lượt** | Vẫn tính (rẻ, và "tôi tính ra" nghe hay), nhưng đừng kỳ vọng nhiều |
| Sweep toàn từ điển để tìm opening là "quá chậm" | **3 giây** nhờ mã hoá pattern thành số base-3 đếm bằng typed array | Cache thành tiện lợi, không phải bắt buộc |
| Từ điển ~15.000 từ | **12.578 từ** từ `word-list`, chứa đủ 4 ground truth | Đạt tiêu chí, giữ nguyên |
| `npm test` = `node --test test/unit/` | Node 22 coi đường dẫn thư mục là module ⇒ **lỗi** | Phải dùng glob: `node --test "test/unit/*.test.ts"` |
| Bật/tắt live test bằng env `VOTEE_LIVE=1` | Set env cross-platform trên Windows lằng nhằng | Tách thư mục `test/unit/` và `test/live/`, hai script riêng. Không cần env |
| `src/` < 700 dòng, mỗi file ≤ 120 | **641 dòng**, `cli.ts` 124 và `strategy.ts` 129 | Tách benchmark ra `src/bench.ts`. Nới giới hạn thành ≤ 130 |

Hai điều **plan đoán đúng và đáng ăn điểm nhất**: `/random` cần ghim seed (không có thì solver không
bao giờ hội tụ), và luật scoring per-slot (10/10 case khớp API thật qua contract test).

Một phát hiện mới chỉ lộ ra khi chạy thật: **toàn bộ ca thất bại đều là họ từ khác nhau đúng một ô** —
`cases`, `doves`, `epees`, `gills`, `gyves`, `nines`, `pined`, `sagos`, `saris`, `sazes`. Ví dụ với
`doves`, không từ nào tách được `doves`/`doges`/`doses`/`dozes`/`dotes` vì các chữ phân biệt
`v`/`g`/`s`/`z`/`t` không thể cùng nằm trong một từ 5 chữ. Đây là giới hạn nội tại của ngân sách 6
lượt, không phải bug — và là câu trả lời sẵn cho câu hỏi "sao không đạt 100%?".

---

## 1. Phát hiện quan trọng nhất — `/random` là STATELESS và KHÔNG deterministic nếu thiếu `seed`

Đây là cái bẫy của bài. Cả 3 endpoint đều **không có session, không có state**. Mỗi request là độc lập.
Với `/random`, **không truyền `seed` thì mỗi request là một từ bí mật KHÁC NHAU**:

```
GET /random?guess=arise&size=5   → a=present r=present i=absent s=absent e=absent
GET /random?guess=arise&size=5   → a=absent   r=correct i=absent s=absent e=absent   ← khác từ!
```

⇒ **Không thể giải `/random` nếu không ghim `seed`.** Có `seed` thì hoàn toàn deterministic
(lặp lại cùng seed + cùng guess cho ra kết quả y hệt — đã kiểm chứng).

**Yêu cầu bắt buộc cho solver:** ở mode `random`, nếu người dùng không truyền `--seed`, solver
**tự sinh một seed nguyên dương ngẫu nhiên một lần duy nhất tại đầu phiên**, in nó ra, rồi dùng
seed đó cho **mọi** guess trong phiên. Như vậy "random word" vẫn đúng nghĩa đề bài (từ do server
chọn, ta không biết), mà bài toán mới well-posed.

> Đây là điểm ăn điểm cao nhất khi live. Hầu hết ứng viên sẽ hoặc không nhận ra, hoặc solver của họ
> sẽ "không bao giờ hội tụ" mà không hiểu tại sao. Bạn nên nói thẳng phát hiện này ra trong buổi ghi hình.

---

## 2. Luật tính điểm — ĐÃ KIỂM CHỨNG, và nó KHÔNG giống Wordle chuẩn

API đánh giá **độc lập từng ô** (per-slot), **không** có cơ chế phân bổ theo số lần xuất hiện của
Wordle thật:

```
Với mỗi vị trí i:
  if   guess[i] === target[i]      → "correct"
  elif target.includes(guess[i])   → "present"
  else                             → "absent"
```

Đã dự đoán trước rồi verify 5/5 case đối kháng khớp tuyệt đối (Phụ lục A). Ví dụ then chốt:

| target | guess | API trả về | Wordle chuẩn sẽ trả về |
| --- | --- | --- | --- |
| `apple` | `allee` | `c p p p c` | `c a p a c` (chỉ 1 chữ `l`, `e` thứ 2 đã dùng) |
| `tests` | `ttttt` | `c p p c p` | `c a a c a` |
| `apple` | `eeeee` | `p p p p c` | `a a a a c` |

**Ba hệ quả bắt buộc phải code đúng:**

1. `absent` ⟺ chữ đó **không tồn tại ở bất cứ đâu** trong target (mạnh hơn Wordle chuẩn).
   Không bao giờ có chuyện một chữ vừa `correct` ở ô này vừa `absent` ở ô khác.
2. `present` **không mang thông tin về số lượng**. Không suy ra được "target có ≥2 chữ e".
   ⇒ Không implement bộ ràng buộc min/max count như solver Wordle thường thấy. Nó sẽ **sai**.
3. Đoán chữ trùng lặp là **lãng phí thuần** (`aaaaa` chỉ cho biết duy nhất "a có/không có trong từ
   và ở đâu"). ⇒ Strategy phải **trừ điểm** guess có chữ lặp.

**Ghi chú thú vị nên đưa vào README (thể hiện độ sâu, nhưng KHÔNG dùng làm solver):** vì per-slot
độc lập, ta có thể *phá* game bằng 26 request `aaaaa`, `bbbbb`, …, `zzzzz` — mọi ô `correct` cho biết
chính xác chữ tại ô đó, tái tạo được từ bí mật trong đúng 26 lượt, không cần từ điển.
Tôi đã dùng đúng cách này để lấy ground truth: `seed=1 → fiery`, `seed=42 → wrote`,
`seed=777 → poise`, `daily → vetch`. Nêu ra như một *security/semantics finding*, và nói rõ lý do
không dùng: đề yêu cầu suy luận, không yêu cầu exploit; và nó tệ hơn (26 lượt vs ~4 lượt).

---

## 3. Từ điển — quyết định và tiêu chí nghiệm thu

Ground truth đã lấy được cho thấy target gồm cả từ hiếm (`vetch` = một loài cây họ đậu). ⇒ **Không
dùng danh sách 2.315 đáp án Wordle chính thức**, sẽ trượt. Phải dùng danh sách **từ 5 chữ hợp lệ
đầy đủ** (~13.000–16.000 từ).

Cách làm (giữ runtime **zero dependency**):

1. Một script chỉ chạy lúc dev: `scripts/build-words.ts`, đọc từ một nguồn npm devDependency
   (đề xuất: `word-list` của sindresorhus, MIT, dữ liệu từ SCOWL), lọc `^[a-z]{5}$`, sort, dedupe.
2. Ghi ra `data/words5.txt`, **commit file này**. Runtime chỉ `readFile` — không cần cài gì để chạy.
3. Ghi nguồn + license vào README (mục attribution — email nói rõ plagiarism sẽ bị đánh giá xấu).

> **Đã dry-run:** `word-list` cho **12.578** từ 5 chữ và chứa đủ cả `fiery`, `wrote`, `poise`,
> `vetch`. Đạt toàn bộ tiêu chí dưới đây. Dùng nguồn này, không cần tìm nguồn khác.

**Tiêu chí nghiệm thu từ điển (bắt buộc chạy, fail thì đổi nguồn):**

- Kích thước trong khoảng 10.000–20.000 từ.
- Phải chứa đủ 4 từ ground truth: `fiery`, `wrote`, `poise`, **`vetch`**.
- Chạy benchmark offline (mục 6) với strategy `entropy` đạt tỉ lệ giải ≥ 97% trong 6 lượt.

Nếu nguồn đã chọn thiếu `vetch`, thử `an-array-of-english-words`, hoặc danh sách
"Wordle allowed guesses" (~14.855 từ) kèm attribution rõ ràng.

---

## 4. Kiến trúc & cấu trúc repo

Ràng buộc: **TypeScript (ESM), Node ≥ 22.18, KHÔNG build step, không framework, runtime
zero-dependency.**

Điều này khả thi vì đã kiểm chứng trên đúng máy sẽ dùng để live (`node v22.18.0`, `npm 10.9.2`):

- `node src/cli.ts` **chạy trực tiếp file `.ts`, không cần flag, không cần `tsx`/`ts-node`/`tsc`.**
  Node tự strip type annotation (type stripping đã bật mặc định từ 22.18).
- `node --test` **tự tìm và chạy `test/**/*.test.ts`.** Không cần Vitest/Jest.

⇒ Có đủ type safety mà vẫn giữ được zero build step và zero runtime dependency. Đây là lựa chọn
tốt nhất và là điểm nên nói ra khi live: *"tôi dùng TypeScript nhưng không có bước build — Node 22
chạy `.ts` native, nên vòng lặp sửa-chạy nhanh như JS"*.

**Ba giới hạn của type stripping — vi phạm là crash lúc runtime, phải biết trước:**

1. **Không** dùng `enum`, `namespace`, parameter properties (`constructor(private x: T)`),
   hay `experimentalDecorators`. Chúng cần *transform*, không chỉ *strip*. Dùng
   `type Mark = 'absent' | 'present' | 'correct'` thay cho `enum`.
2. Import phải ghi **đủ đuôi `.ts`**: `import { score } from './feedback.ts'`. Cần
   `"allowImportingTsExtensions": true` trong `tsconfig.json`.
3. Import chỉ chứa type phải dùng `import type { … }` (bật `verbatimModuleSyntax`).

`tsc` vẫn có mặt nhưng **chỉ để type-check, không để build**: `npm run typecheck` = `tsc --noEmit`.
`devDependencies`: `typescript`, `@types/node`, `word-list`. `dependencies`: **rỗng**.

`tsconfig.json` tối thiểu: `strict: true`, `module/moduleResolution: nodenext`, `target: es2023`,
`noEmit: true`, `allowImportingTsExtensions: true`, `verbatimModuleSyntax: true`.

```
votee-wordle-solver/
├── package.json              # type:module, scripts, chỉ devDependencies
├── tsconfig.json             # noEmit — chỉ để type-check
├── README.md
├── .gitignore                # node_modules
├── data/
│   └── words5.txt            # ~15k từ, 1 từ mỗi dòng (committed)
├── scripts/
│   └── build-words.ts        # dev-only, sinh data/words5.txt
├── src/
│   ├── types.ts              # Mark, Feedback, Oracle, SolveResult
│   ├── api.ts                # 3 oracle → response đã normalize
│   ├── feedback.ts           # luật scoring (bản local, mirror API)
│   ├── filter.ts             # lọc candidate theo feedback
│   ├── constraints.ts        # dẫn xuất ràng buộc — CHỈ để hiển thị (xem 5.3b)
│   ├── strategy.ts           # chọn guess tiếp theo
│   ├── solver.ts             # game loop, oracle-agnostic
│   ├── bench.ts              # chạy nhiều ván offline, trả số liệu thuần (không in)
│   ├── words.ts              # load từ điển + opening đã cache
│   └── cli.ts                # parse arg, render output
└── test/
    ├── unit/                 # `npm test` — không cần mạng
    │   ├── helpers.ts        # PRNG deterministic + lấy mẫu
    │   ├── feedback.test.ts
    │   ├── filter.test.ts
    │   ├── constraints.test.ts
    │   ├── strategy.test.ts
    │   └── solver.test.ts    # gồm benchmark thu nhỏ
    └── live/                 # `npm run test:live` — cần mạng
        └── api.test.ts
```

Tách `test/unit/` và `test/live/` thành hai thư mục thay vì dùng biến môi trường: set env
cross-platform trên Windows lằng nhằng, còn hai script trỏ vào hai thư mục thì không thể sai.
Lưu ý Node 22 **không nhận đường dẫn thư mục** cho `--test`, phải dùng glob:
`node --test "test/unit/*.test.ts"`.

Thực tế dry-run: **641 dòng** trong `src/`. Mỗi file một trách nhiệm, đọc là hiểu.

`package.json` scripts (đã chạy được, copy nguyên):

```
start        : node src/cli.ts
solve:random : node src/cli.ts --mode random
solve:daily  : node src/cli.ts --mode daily
bench        : node src/cli.ts --mode bench
test         : node --test "test/unit/*.test.ts"
test:live    : node --test "test/live/*.test.ts"
typecheck    : tsc --noEmit
build:words  : node scripts/build-words.ts
build:opening: node scripts/best-opening.ts
```

`tsconfig.json` đã kiểm chứng với TypeScript 7.0.2: bật thêm `erasableSyntaxOnly` để **compiler chặn
sẵn** `enum`/`namespace`/parameter property — nhờ vậy lỗi type stripping thành lỗi type-check thay vì
crash lúc chạy. Kèm `noUncheckedIndexedAccess` (đáng giá vì code truy cập `word[i]` liên tục).

### Data shape dùng xuyên suốt (`src/types.ts`, chốt cứng, không đổi)

```ts
type Mark     = 'absent' | 'present' | 'correct'   // KHÔNG dùng enum — type stripping không hỗ trợ
type Feedback = Mark[]        // length = size, index = slot
type Oracle   = (guess: string) => Promise<Feedback>
```

`Feedback` **không** giữ lại hình dạng `{slot, guess, result}` của API — normalize ngay tại `api.ts`.

Quy tắc quan trọng: **`api.ts` là biên giới duy nhất biết đến hình dạng response của Votee.** Mọi
module khác chỉ thấy `Mark[]`. Nhờ vậy solver test được hoàn toàn offline.

---

## 5. Spec từng module (contract, không phải code)

### 5.1 `src/api.ts`

Export:

| Hàm | Signature | Ghi chú |
| --- | --- | --- |
| `createWordOracle` | `(target: string) => Oracle` | `GET /word/{target}?guess=…` |
| `createRandomOracle` | `(seed: number, size: number) => Oracle` | `GET /random?guess=…&size=…&seed=…`, **seed bắt buộc** |
| `createDailyOracle` | `(size: number) => Oracle` | `GET /daily?guess=…&size=…` |

Base URL: `https://wordle.votee.dev:8000`, đặt thành một hằng ở đầu file, cho phép override qua
`process.env.VOTEE_BASE_URL`.

Yêu cầu hành vi:

- Normalize guess: `trim().toLowerCase()` trước khi gửi. (API nhận `ARISE` nhưng luôn echo lowercase.)
- Response là **array không đảm bảo thứ tự** theo hợp đồng ⇒ dựng `Feedback` bằng cách gán theo
  `item.slot`, **không** dựa vào thứ tự phần tử. Sau khi dựng, assert không còn ô nào trống —
  nếu có, throw (API trả thiếu slot là lỗi thật, không được im lặng).
- Lỗi HTTP: **không** trả `null`, không retry vô hạn. Throw `Error` với message chứa status + URL +
  body. Riêng `400` là lỗi lập trình của ta (xem bảng validation dưới) ⇒ message phải nói rõ.
- Retry: chỉ retry với lỗi mạng/5xx, tối đa 2 lần, backoff 300ms/900ms. Không retry 4xx.

Validation của server (đã kiểm chứng — dùng để viết message lỗi cho đúng):

| Tình huống | Kết quả thật |
| --- | --- |
| `guess.length !== size` | `400 Bad Request` |
| guess chứa ký tự không phải chữ (`ar1se`) | `400 Bad Request` |
| `seed` âm | `500 Internal Server Error` ⇒ seed ta sinh phải là số nguyên dương |
| `size` khác 5 (4, 6) | Hợp lệ, hoạt động bình thường |
| `/word/{target}` không cần `size` | Hợp lệ, suy ra từ độ dài target |

### 5.2 `src/feedback.ts`

| Hàm | Signature | Hành vi |
| --- | --- | --- |
| `score` | `(guess: string, target: string) => Feedback` | Implement **đúng** luật mục 2, per-slot |

Đây là bản mô phỏng local của server. Dùng cho: benchmark offline, và (quan trọng) một test đối
chiếu chạy thật với `/word/{target}` để chứng minh mô hình của ta khớp API.

### 5.3 `src/filter.ts`

| Hàm | Signature | Hành vi |
| --- | --- | --- |
| `isConsistent` | `(candidate, guess, feedback) => boolean` | true nếu `candidate` có thể là target |
| `filterCandidates` | `(candidates: string[], guess, feedback) => string[]` | lọc danh sách |

Cách implement `isConsistent` **được khuyến nghị mạnh**: `score(guess, candidate)` bằng đúng
`feedback` (so sánh từng phần tử). Một dòng, không thể sai lệch so với server, và không cần viết
tay các luật ràng buộc riêng lẻ.

Ý tưởng đằng sau, phải nói được khi live: *"nếu candidate X là từ bí mật thật, thì server đã phải
trả về `score(guess, X)`. Server trả về `feedback`. Vậy X còn khả thi ⟺ `score(guess, X) === feedback`."*
Đây là suy luận ngược, và nó đúng **chính xác** vì `score` là bản mirror của luật server (mục 2 đã
verify 5/5).

### 5.3b `src/constraints.ts` — CHỈ để hiển thị, KHÔNG để lọc

Đây là "constraint model": thay vì so khớp cả pattern, ta **tích luỹ tri thức tường minh** về từ bí
mật qua các lượt. Bốn cấu trúc:

```ts
type Knowledge = {
  fixed:     (string | null)[]   // fixed[0]='f' → ô 0 chắc chắn là 'f'        (từ 'correct')
  required:  Set<string>         // chữ chắc chắn CÓ trong từ, chưa biết ở đâu (từ 'present')
  forbidden: Set<string>         // chữ chắc chắn KHÔNG có ở bất kỳ đâu        (từ 'absent')
  bannedAt:  Set<string>[]       // bannedAt[1] ∋ 'r' → ô 1 chắc chắn KHÔNG phải 'r'
}
```

Luật cập nhật, với mỗi ô `i` mang chữ `c`:

| Feedback tại ô i | Cập nhật |
| --- | --- |
| `correct` | `fixed[i] = c` |
| `present` | `required.add(c)` **và** `bannedAt[i].add(c)` |
| `absent` | `forbidden.add(c)` |

Ví dụ thật (target `fiery`, guess `crane` → API trả `a p a a p`):

```
forbidden = {c, a, n}        ← c,a,n không có trong "fiery"
required  = {r, e}           ← r,e có trong "fiery" nhưng sai vị trí
bannedAt[1] = {r}            ← 'r' không ở ô 1
bannedAt[4] = {e}            ← 'e' không ở ô 4
fixed     = [_, _, _, _, _]  ← chưa biết ô nào
```

Một candidate hợp lệ ⟺ khớp mọi `fixed`, chứa mọi chữ trong `required`, không chứa chữ nào trong
`forbidden`, và không vi phạm `bannedAt`.

**Quyết định thiết kế: dùng constraint model để KỂ, dùng score-match để LỌC.**

Lý do: với luật per-slot, hai cách **tương đương hoàn toàn về mặt logic** — mỗi mark ánh xạ 1-1 sang
một ràng buộc (`correct`→fixed, `present`→required+bannedAt, `absent`→forbidden), không mất mát
thông tin. Nhưng score-match là một *hàm thuần một dòng*, còn constraint model là *4 cấu trúc mutable
phải maintain qua nhiều lượt* — nhiều bề mặt lỗi hơn mà không lọc chính xác hơn.

Ngược lại, constraint model **kể chuyện tốt hơn nhiều**. Nó cho phép in ra:

```
known: f _ _ _ _   must have: r, e   ruled out: c, a, n   not at: r@1, e@4
```

Đó là thứ người xem recording hiểu ngay, còn "candidates: 15342 → 41" thì không giải thích *vì sao*.

⇒ `constraints.ts` export `updateKnowledge(knowledge, guess, feedback)` và `describe(knowledge)`,
`cli.ts` gọi để in. `solver.ts` **không** phụ thuộc vào nó. Tách rõ "logic" và "narrative" như vậy
vừa an toàn vừa demo tốt — và bản thân việc bạn giải thích được *tại sao tách* chính là điểm cộng.

> Nếu muốn, thêm một test `constraints.test.ts` chứng minh hai cách cho kết quả lọc **giống nhau**
> trên 200 cặp (target, guess) ngẫu nhiên. Test này biến "tôi tin chúng tương đương" thành "tôi
> chứng minh chúng tương đương" — rất đáng 5 phút.

### 5.4 `src/strategy.ts`

| Hàm | Signature | Hành vi |
| --- | --- | --- |
| `pickGuess` | `(candidates: string[], opts) => string` | chọn guess kế tiếp, **deterministic** |

Thuật toán: **positional letter frequency + penalty chữ lặp** (bám ý tưởng của "The Dodgy Engineer"
trong `optimizing-wordle.md`, nhưng đã sửa lại — xem ghi chú bên dưới).

```
1. freq[pos][letter] = số candidate có `letter` tại `pos`
2. score(word) = Σ_{pos=0..n-1} freq[pos][word[pos]]
3. Nếu word có chữ lặp: score *= 0.5 ^ (số chữ bị lặp)     // per-slot ⇒ chữ lặp gần như vô ích
4. Chọn score CAO nhất. Tie-break bằng thứ tự alphabet     // để deterministic
```

Ghi chú bắt buộc đọc — **đừng copy nguyên đoạn code trong `optimizing-wordle.md`**:

- Đoạn code đó bị **lỗi cú pháp** (mấy chỗ `= ;` và `= ` là array literal bị mất khi trích xuất) và
  **lỗi logic** (`return words` / `bestWord = words` thay vì `words[0]`).
- Công thức của nó là `Π (maxFreq[pos] − freq[pos])` rồi **minimize**. Cái này vỡ khi bất kỳ ô nào có
  `freq === maxFreq`: tích thành 0, hàng loạt từ đồng điểm 0 ⇒ về bản chất là chọn bừa. Công thức
  tổng-tần-suất-maximize ở trên đơn giản hơn, tương đương về ý tưởng ("chọn chữ phổ biến theo vị
  trí"), và không có bệnh lý đó.
- README phải credit: kênh **The Dodgy Engineer** (ý tưởng positional frequency), **3Blue1Brown**
  (framing information theory), **NYT "Best Wordle Tips"** (heuristic dàn chữ/nguyên âm), và ghi rõ
  là *đã điều chỉnh*, không phải sao chép.

Guess mở đầu: **không hardcode `slate`.** Tính bằng `scripts/best-opening.ts` (entropy trên toàn từ
điển) và ghi ra `data/opening.json`.

> **Đã dry-run.** Kết quả là **`tares` — 6,2024 bits**, trên `lares` (6,1560) và `rales` (6,1206).
> Đáng chú ý: `soare` — từ mở đầu tối ưu quen thuộc của Wordle chuẩn — chỉ xếp **thứ 7** ở đây, đúng
> như dự đoán rằng luật per-slot đổi thứ tự tối ưu. Đây là dữ kiện tốt để nói khi live.
>
> Sweep toàn bộ 12.578² cặp chỉ mất **3 giây** nhờ mã hoá pattern thành số base-3
> (`absent=0, present=1, correct=2`) rồi đếm bằng `Int32Array(243)`, tránh cấp phát 158 triệu string.
> Nhanh đến mức cache chỉ còn là tiện lợi.
>
> Nhưng đừng kỳ vọng nhiều: đổi từ `cares` (heuristic chọn) sang `tares` chỉ đổi số lượt trung bình
> khoảng 0,01. **Strategy quyết định gần như toàn bộ kết quả, không phải opening word.**

#### Nâng cấp: `--strategy=minimax` (Milestone 7)

**Minimax là gì.** Heuristic tần suất ở trên chỉ *đoán* xem guess nào tốt, thông qua một proxy là
"chữ phổ biến theo vị trí". Minimax thì **đo trực tiếp** guess đó chia nhỏ không gian tìm kiếm tốt
đến đâu.

Quan sát nền tảng: khi ta đoán `g`, mọi candidate còn lại được **phân hoạch thành các nhóm theo
pattern feedback** mà chúng sẽ tạo ra. Server trả về một pattern ⇒ candidate set mới **chính là**
nhóm ứng với pattern đó. Ta chưa biết sẽ rơi vào nhóm nào, nên đánh giá guess bằng **trường hợp xấu
nhất**: kích thước nhóm lớn nhất.

Ví dụ, còn 100 candidate:

| Guess | Các nhóm sinh ra | Nhóm lớn nhất (worst case) |
| --- | --- | --- |
| `A` | 60 / 25 / 15 | **60** |
| `B` | 20 / 18 / 15 / 13 / 12 / 10 / 7 / 5 | **20** |

Đoán `B` **đảm bảo** còn ≤ 20 từ; đoán `A` có thể còn tới 60. ⇒ Chọn `B`.

```
minimax(g) = max over pattern p của | { c ∈ candidates : score(g, c) === p } |
pickGuess  = argmin over g của minimax(g)        // tie-break: ưu tiên g ∈ candidates, rồi alphabet
```

Tie-break "ưu tiên `g` nằm trong candidates" rất quan trọng: nếu hai guess chia nhóm bằng nhau, chọn
cái **có thể chính là đáp án** để có cơ hội thắng ngay lượt này.

**Hai biến thể nên biết để nói khi live** (cùng phân hoạch, khác cách chấm):

- **Expected size** — `Σ |nhóm|² / |C|`, rồi minimize. Tối ưu *trung bình* thay vì *xấu nhất*.
- **Entropy** — `Σ −p·log₂ p` với `p = |nhóm|/|C|`, rồi maximize. Đây chính là "information gain"
  theo nghĩa lý thuyết thông tin, là cách tiếp cận của video 3Blue1Brown.

Thực tế entropy/expected thường tốt hơn minimax một chút về số lượt trung bình, còn minimax cho
**đảm bảo** về worst case. Cả ba đều dùng chung một bước phân hoạch, nên khi đã code xong minimax
thì thêm biến thể chỉ là đổi hàm chấm điểm — nếu còn thời gian, benchmark cả ba và đưa bảng vào README.

**Chi phí và cách chặn.** Phân hoạch với mọi guess ứng viên là `O(|G| · |C| · n)`. Với
`|G| = |C| = 15.000` thì ~225 triệu phép `score` ⇒ **quá chậm cho lượt 1**. Cách xử lý:

- Lượt 1: dùng opening word đã cache (candidate set là toàn bộ từ điển, luôn cho cùng kết quả).
- Từ lượt 2: chỉ bật minimax khi `candidates.length ≤ 300` (sau lượt 1 gần như luôn thoả).
- Guess pool: mặc định `G = candidates`. **Tuỳ chọn nâng cao:** cho phép `G` = toàn từ điển khi
  `candidates.length ≤ 30` và còn ≥ 2 lượt. Lý do là tình huống kinh điển kiểu `_ight`
  (`light/might/night/right/sight/tight`): mọi candidate chỉ khác nhau 1 chữ nên đoán trong nhóm chỉ
  loại được 1 từ mỗi lượt và sẽ hết lượt; một từ "dò" như `mirth` không thể là đáp án nhưng tách
  được nhiều từ cùng lúc. **Đây là khoảnh khắc demo đẹp nhất** — nếu bắt được nó trong recording,
  hãy dừng lại giải thích.

> **Đã dry-run — kết quả đảo ngược đề xuất ban đầu của plan.** Đo trên cùng mẫu, cùng opening:
>
> | Strategy | Mẫu | Giải được | Số lượt TB | Thời gian |
> | --- | --- | --- | --- | --- |
> | `entropy` | 1000 | **99,0%** | **4,22** | 39,7s |
> | `entropy` | 300 | 99,3% | 4,18 | 10,9s |
> | `minimax` | 300 | 99,7% | 4,29 | 12,4s |
> | `freq` | 300 | 90,7% | 4,28 | 0,6s |
>
> ⇒ **Mặc định là `entropy`**, không phải `freq`. `freq` nhanh hơn 20 lần nhưng thất bại nhiều gấp 9,
> nên chỉ giữ nó làm fallback khi còn > 300 candidate (lúc đó phân hoạch quá đắt) và làm mốc so sánh.
>
> Minimax cho tỉ lệ giải cao nhất nhưng số lượt trung bình tệ hơn — đúng bản chất: nó tối ưu trường
> hợp xấu nhất, không tối ưu trung bình. Implement cả ba vì chúng dùng chung bước phân hoạch, chi phí
> thêm chỉ là hai hàm chấm điểm, và bảng so sánh này chính là thứ đáng đưa vào README.
>
> Nới `maxPartitionCandidates` từ 300 lên 2000 **không cải thiện** (4,20 vs 4,17) mà chậm gấp đôi.
> Giữ 300. Ghi lại thí nghiệm này trong README như một ví dụ "đo trước khi tối ưu".

### 5.5 `src/words.ts`

| Hàm | Signature | Hành vi |
| --- | --- | --- |
| `loadWords` | `(size = 5) => string[]` | đọc `data/words5.txt`, filter đúng `size`, lowercase, unique |

Nếu `size !== 5` mà không có từ điển tương ứng ⇒ throw message rõ ràng ("chỉ hỗ trợ size 5, đã có
`data/words5.txt`; sinh thêm bằng `npm run build:words`"). Đừng cố hỗ trợ mọi size trong bản đầu.

### 5.6 `src/solver.ts`

```
solve({ oracle, words, size, maxAttempts = 6, onProgress }) =>
  { solved: boolean, answer: string|null, attempts: number, history: [{guess, feedback, remaining}] }
```

Vòng lặp:

```
candidates = words
for attempt in 1..maxAttempts:
    guess    = pickGuess(candidates)
    feedback = await oracle(guess)
    onProgress({attempt, guess, feedback, ...})
    if feedback mọi ô đều 'correct' → solved, answer = guess, return
    candidates = filterCandidates(candidates, guess, feedback)
    if candidates.length === 0 → throw DictionaryGapError(...)   // xem mục 8
return { solved: false, ... }
```

Hai điều solver **không** được làm: không `console.log` (dùng `onProgress` callback — nhờ đó test
im lặng, CLI đẹp), và không biết `seed`/endpoint nào (nhận `oracle` đã dựng sẵn).

### 5.7 `src/cli.ts`

```
node src/cli.ts --mode random [--seed 12345] [--size 5] [--strategy freq|minimax]
node src/cli.ts --mode daily
node src/cli.ts --mode word --target apple
node src/cli.ts --mode bench [--count 200] [--seed 1]
```

Parse arg **thủ công** bằng `process.argv` (hoặc `node:util` `parseArgs`) — không thêm `yargs`/`commander`.

Yêu cầu output (buổi live được ghi hình, output chính là phần thuyết trình của bạn):

```
Votee Wordle Solver
mode=random  size=5  seed=1  strategy=freq      ← seed PHẢI in ra, để reproduce được
dictionary: 15,342 words

#1  crane   absent present absent absent present
    known: _ _ _ _ _   must have: r,e   ruled out: c,a,n   not at: r@1, e@4
    candidates: 15,342 → 218

#2  ...

SOLVED  "fiery"  in 4 guesses
```

Dòng `known/must have/ruled out/not at` lấy từ `constraints.ts` (mục 5.3b). Ví dụ trên là feedback
**thật** của `crane` với `seed=1` (đáp án `fiery`) — dùng đúng nó khi test render.

Bắt buộc: in `seed`, in số candidate còn lại sau mỗi lượt (đây là bằng chứng thuật toán đang hoạt
động), và tô màu bằng ANSI escape thuần (`\x1b[42m`…) — **không** thêm `chalk`.

Exit code: `0` nếu giải được, `1` nếu hết lượt, `2` nếu lỗi API/từ điển.

---

## 6. Chiến lược test

Nguyên tắc: **toàn bộ logic test được offline, không cần mạng.** Test mạng tách riêng và opt-in
(mạng sập giữa buổi live thì `npm test` vẫn xanh).

### 6.1 `feedback.test.ts` — dùng chính các case đã verify với server thật

Đây là các cặp input/output **thực tế từ API** (không phải tôi tự nghĩ ra). Hardcode làm bảng test:

| target | guess | expected (a=absent, p=present, c=correct) |
| --- | --- | --- |
| `apple` | `apple` | `c c c c c` |
| `apple` | `zzzzz` | `a a a a a` |
| `apple` | `arise` | `c a a a c` |
| `apple` | `allee` | `c p p p c` |
| `apple` | `eeeee` | `p p p p c` |
| `apple` | `pppaa` | `p c c p p` |
| `apple` | `pzzzp` | `p a a a p` |
| `tests` | `tooot` | `c a a a p` |
| `tests` | `ttttt` | `c p p c p` |
| `teyyy` | `ttttt` | `c p p p p` |

### 6.2 `filter.test.ts`

- Target thật luôn nằm trong danh sách sau khi lọc (property test: với 100 target ngẫu nhiên và 100
  guess ngẫu nhiên, `isConsistent(target, guess, score(guess, target))` luôn true).
- `absent` loại bỏ mọi từ chứa chữ đó ở **bất kỳ** vị trí.
- `present` loại từ có chữ đó ở đúng vị trí đã đoán.
- Sau khi lọc bằng feedback all-correct, còn lại đúng 1 từ.
- **Tương đương constraint ⇄ score-match** (mục 5.3b): với 200 cặp `(target, guess)` ngẫu nhiên
  deterministic, lọc bằng `Knowledge` và lọc bằng `score`-so-khớp cho ra **cùng một tập**. Test này
  biến "tôi tin hai cách tương đương" thành "tôi chứng minh được".

### 6.3 `strategy.test.ts`

- Deterministic: gọi 2 lần cùng input ⇒ cùng output.
- `candidates.length === 1` ⇒ trả về chính từ đó.
- Guess được chọn có nhiều chữ phân biệt hơn phương án chữ lặp, khi điểm tần suất xấp xỉ nhau.

### 6.4 `solver.test.ts` — quan trọng nhất

Dựng một **oracle offline** từ `score()` (chính là `createWordOracle` nhưng local). Rồi:

- Giải đúng 4 ground truth: `fiery`, `wrote`, `poise`, `vetch`.
- **Benchmark** trong test: mẫu **150** từ (chạy ~5s, đủ nhanh để nằm trong `npm test`). Assert:
  - tỉ lệ giải trong 6 lượt **≥ 97%**
  - số lượt trung bình **≤ 4,4**
- Hai ngưỡng trên là **số đo được** (`entropy` đạt 99,0% và 4,22 lượt trên mẫu 1.000), đã nới ra chút
  cho dao động của mẫu nhỏ. Ngưỡng ≥99%/≤4,2 mà plan đoán lúc đầu là **sai** — xem mục 0.5.
- Benchmark đầy đủ (1.000 mẫu, phân bố 1..6 lượt) chạy qua CLI `--mode bench --count 1000`, không đưa
  vào `npm test` vì mất ~40s.
- Nếu assert fail ⇒ **không nới lỏng ngưỡng**. Xem lại từ điển hoặc strategy.

### 6.5 `test/live/api.test.ts` — integration, chạy bằng `npm run test:live`

- **Contract test (test giá trị nhất trong repo):** với target `apple` và 5 guess ở bảng 6.1, gọi
  `/word/apple` thật và assert response khớp `score()` local. Đây là bằng chứng mô hình của ta đúng
  bằng API thật — nói câu này khi live.
- Giải `/random?seed=1` end-to-end, assert answer `=== 'fiery'`.
- Giải `/daily` end-to-end, assert solved (không assert từ cụ thể — nó đổi mỗi ngày).
- Assert `/random` **không seed** gọi 2 lần có thể ra feedback khác nhau ⇒ tài liệu hoá phát hiện
  mục 1 bằng một test (test này có thể flaky về lý thuyết; đánh dấu và giải thích trong comment,
  hoặc gọi 6 lần và assert "có ít nhất 2 kết quả khác nhau").

---

## 7. Milestones — thứ tự tối ưu cho buổi live coding

Nguyên tắc sắp xếp: **có demo chạy được sớm nhất có thể**, rồi mới làm đẹp. Mỗi milestone kết thúc ở
trạng thái commit được.

| # | Việc | Thời lượng | Trạng thái đạt được |
| --- | --- | --- | --- |
| 0 | `npm init`, `package.json` (`type:module`), `tsconfig.json`, `.gitignore`, `src/types.ts`, `scripts/build-words.ts`, sinh `data/words5.txt`, **verify tiêu chí mục 3** | 12' | Có từ điển đã kiểm chứng, `node src/…ts` chạy được |
| 1 | `feedback.ts` + `feedback.test.ts` (bảng 6.1) | 10' | Luật scoring đúng, có test xanh |
| 2 | `filter.ts` + test | 8' | Lọc được candidate |
| 3 | `strategy.ts` (heuristic tần suất) + test | 12' | Chọn được guess |
| 4 | `solver.ts` + `solver.test.ts` với oracle offline | 12' | **Giải được offline — demo đầu tiên** |
| 5 | `api.ts` + `cli.ts`, mode `word` rồi `daily` rồi `random` | 15' | **Giải được puzzle thật qua mạng** |
| 6 | `constraints.ts` + đấu nối vào output CLI | 8' | Output kể được *vì sao* |
| 7 | Benchmark + `api.test.ts` contract test | 10' | Có số liệu cho README |
| 8 | `--strategy=minimax` + so sánh benchmark | 15' | Điểm cộng lớn nhất |
| 9 | `npm run typecheck` sạch + README theo mục 9 | 18' | Sẵn sàng submit |

Nếu thời gian phiên ghi hình bị bó: milestone 0–5 là **bắt buộc** (đây là bộ xương, thiếu là không
có gì để demo); 6 và 8 là hai thứ *ăn điểm* nên ưu tiên hơn 7; 7 và 9 làm được offline sau khi
tắt máy ghi.

**Cảnh báo về milestone 8:** minimax dễ ngốn quá 15 phút nếu bạn vừa code vừa giải thích. Nếu đến
phút thứ 10 vẫn chưa chạy được, `git stash` và quay lại heuristic — có một solver hoạt động tốt quan
trọng hơn một solver tối ưu đang lỗi. Nói thẳng câu đó ra khi live cũng là một tín hiệu tốt về
engineering judgement.

**Chốt thứ tự mode ở milestone 5 là có lý do:** `word` trước (biết đáp án, dễ debug nhất) → `daily`
(ẩn nhưng ổn định) → `random` (ẩn + cần seed). Nếu có bug, bạn phát hiện ở bước dễ nhất.

---

## 8. Rủi ro & edge case — kèm cách xử lý bắt buộc

| Rủi ro | Mức độ | Xử lý |
| --- | --- | --- |
| **Từ bí mật không có trong từ điển của ta** ⇒ candidates rỗng | Cao | Throw `DictionaryGapError` với message rõ: "danh sách candidate rỗng sau lượt N — từ bí mật không có trong từ điển". **Tuyệt đối không im lặng, không fallback đoán bừa.** Thà fail rõ ràng và giải thích được khi live. Có thể thêm fallback tuỳ chọn: nới dần bằng cách chỉ giữ ràng buộc `correct` |
| **Quên ghim `seed` ở mode random** | Cao | Solver không cho phép tạo random oracle mà thiếu seed (throw). CLI sinh + in seed |
| Copy nguyên code từ `optimizing-wordle.md` | Cao | Code đó lỗi cú pháp + lỗi logic. Xem mục 5.4. Phải viết lại |
| Implement duplicate-handling kiểu Wordle chuẩn | Cao | Sẽ **sai** so với API này. Xem mục 2 |
| Mạng chậm/sập giữa buổi live | Trung bình | Toàn bộ test là offline; mode `word` local; retry 5xx |
| Rate limit / 429 | Thấp (chưa thấy) | Xử lý trong retry logic của `api.ts` |
| Response thiếu slot / thứ tự lạ | Thấp | Dựng Feedback theo `slot`, assert đầy đủ |
| `size` khác 5 | Thấp | Hỗ trợ trong API layer; từ điển chỉ có size 5 ⇒ throw message rõ |
| Đã giải xong ở lượt 1 | Thấp | Kiểm tra all-correct **trước** khi lọc |
| Benchmark chậm | Thấp | Cap minimax ở ≤300 candidate; benchmark chạy offline nên nhanh |

---

## 9. Outline README (deliverable — email chấm cả cái này)

1. **What it does** — 3 câu + một block output mẫu ngay đầu file.
2. **Quick start** — `npm install` (chỉ devDeps) / `npm start -- --mode random` / `npm test`.
3. **Hiểu API Votee** — bảng 3 endpoint, shape response, và bảng validation ở mục 5.1.
4. **Phát hiện 1: `/random` stateless, cần seed** — kèm log 2 request khác nhau. *Đây phải là mục
   nổi bật, nó là insight chính.*
5. **Phát hiện 2: scoring là per-slot, không phải Wordle chuẩn** — kèm bảng so sánh ở mục 2 và cách
   ta chứng minh (contract test).
6. **Phát hiện 3: hệ quả bảo mật (26-guess reconstruction)** — nêu, kèm lý do không dùng.
7. **Kiến trúc** — sơ đồ oracle/solver ở mục 0, và giải thích tại sao tách như vậy.
8. **Thuật toán** — filter, positional frequency scoring, penalty chữ lặp, tie-break, opening word
   được tính ra (không hardcode).
9. **Kết quả** — bảng benchmark: tỉ lệ giải, số lượt trung bình, phân bố 1–6 lượt, so sánh
   freq vs minimax.
10. **Độ phức tạp** — `score` O(n²) với n=5 (thực chất hằng số); filter O(|C|·n²); heuristic
    O(|C|·n); minimax O(|G|·|C|·n²) và lý do cap.
11. **Testing** — offline vs live, cách chạy live (`npm run test:live`).
12. **Attribution** — nguồn từ điển + license; The Dodgy Engineer; 3Blue1Brown; NYT Wordle tips;
    ghi rõ AI assistance đã dùng và phần nào là quyết định của bạn. Email nói rõ về plagiarism —
    minh bạch ở đây là *cộng điểm*, không phải trừ.
13. **Limitations & future work** — chỉ size 5; heuristic không optimal; chưa dùng entropy đầy đủ /
    two-step lookahead; dictionary gap.

---

## 10. Definition of Done

- [ ] `npm test` xanh, không cần mạng.
- [ ] `npm run test:live` xanh, gồm contract test đối chiếu `score()` với API thật.
- [ ] `--mode random` không truyền seed: in seed ra và giải được.
- [ ] `--mode daily` giải được.
- [ ] `--mode word --target vetch` giải được (từ hiếm).
- [ ] Benchmark ≥ 97% giải trong 6 lượt, trung bình ≤ 4,4 lượt (mẫu 150 — xem mục 0.5).
- [ ] `npm run typecheck` (`tsc --noEmit`) sạch, `strict: true`, **không có `any`** trong `src/`.
- [ ] Không dùng `enum`/`namespace`/parameter property (type stripping sẽ crash — mục 4).
- [ ] Runtime `dependencies` = **rỗng**; không có bước build.
- [ ] Tổng LOC `src/` < 700, không file nào > 130 dòng (dry-run: 641 dòng, max 129).
- [ ] `constraints.ts` không được import bởi `solver.ts` (chỉ `cli.ts` dùng).
- [ ] README có đủ 13 mục, gồm cả 3 phát hiện về API.
- [ ] Bạn giải thích được **từng file** trong 2 câu. Nếu không → xoá/đơn giản hoá file đó.

---

## Phụ lục A — Log kiểm chứng API (đã chạy thật, 2026-08-14)

Base: `https://wordle.votee.dev:8000` · Spec lấy từ `/openapi.json` (FastAPI 0.1.0).
`GuessResult = {slot: int, guess: str, result: absent|present|correct}`; cả 3 endpoint trả `GuessResult[]`.
Params: `/word/{word}?guess`; `/random?guess&size=5&seed`; `/daily?guess&size=5`.

```
# --- Luật scoring: 5/5 dự đoán per-slot khớp tuyệt đối ---
/word/tests?guess=ttttt  → c p p c p     (Wordle chuẩn: c a a c a)
/word/apple?guess=eeeee  → p p p p c     (Wordle chuẩn: a a a a c)
/word/apple?guess=pppaa  → p c c p p
/word/apple?guess=zzzzz  → a a a a a
/word/apple?guess=pzzzp  → p a a a p
/word/tests?guess=tooot  → c a a a p
/word/teyyy?guess=ttttt  → c p p p p
/word/apple?guess=allee  → c p p p c     (Wordle chuẩn: c a p a c)
/word/apple?guess=apple  → c c c c c
/word/apple?guess=ARISE  → c a a a c     (uppercase được nhận, echo về lowercase)

# --- /random KHÔNG deterministic nếu thiếu seed (từ khác nhau giữa 2 request) ---
/random?guess=arise&size=5          → a=present r=present i=absent s=absent e=absent
/random?guess=arise&size=5          → a=absent   r=correct i=absent s=absent e=absent

# --- có seed thì deterministic (2 lần gọi giống hệt) ---
/random?guess=arise&size=5&seed=1   → a=absent r=present i=present s=absent e=present
/random?guess=arise&size=5&seed=1   → a=absent r=present i=present s=absent e=present

# --- ground truth, tái tạo bằng 26 request aaaaa..zzzzz ---
seed=1 → fiery    seed=42 → wrote    seed=777 → poise    daily(2026-08-14) → vetch

# --- validation ---
guess.length !== size        → 400
guess có ký tự không phải chữ → 400
seed âm                      → 500
size = 4 hoặc 6              → OK
/word/{target} không có size → OK (suy từ độ dài target)
```

## Phụ lục B — Những gì KHÔNG làm

Web UI · React/Next · bước build (`tsc` sinh `dist/`, esbuild, vite) · `tsx`/`ts-node` · Vitest/Jest ·
`chalk`/`yargs`/`axios`/`commander`/`lodash` · `enum`/`namespace`/decorator · `any` · dropdown "chọn
endpoint" · nhiều lớp abstraction (interface/factory/DI container) · file sinh tự động khổng lồ ·
LLM bên trong solver · Docker · hardcode `seed` trong logic solver · hardcode opening word ·
copy-paste code từ `optimizing-wordle.md` · dùng constraint model để lọc (chỉ để hiển thị).
