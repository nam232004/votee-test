# PLAN — Votee Wordle Solver (live coding, Node.js thuần)

> Tài liệu này là **spec để thực thi**, không phải code. Người/model thực thi chỉ cần đọc file này,
> không cần bất kỳ ngữ cảnh nào khác. Mọi phát hiện về API trong đây đều **đã được kiểm chứng bằng
> request thật** (log ở Phụ lục A) — không phải phỏng đoán.

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

1. Một script chỉ chạy lúc dev: `scripts/build-words.mjs`, đọc từ một nguồn npm devDependency
   (đề xuất: `word-list` của sindresorhus, MIT, dữ liệu từ SCOWL), lọc `^[a-z]{5}$`, sort, dedupe.
2. Ghi ra `data/words5.txt`, **commit file này**. Runtime chỉ `readFile` — không cần cài gì để chạy.
3. Ghi nguồn + license vào README (mục attribution — email nói rõ plagiarism sẽ bị đánh giá xấu).

**Tiêu chí nghiệm thu từ điển (bắt buộc chạy, fail thì đổi nguồn):**

- Kích thước trong khoảng 10.000–20.000 từ.
- Phải chứa đủ 4 từ ground truth: `fiery`, `wrote`, `poise`, **`vetch`**.
- Chạy benchmark offline (mục 6) đạt tỉ lệ giải ≥ 99% trong 6 lượt.

Nếu nguồn đã chọn thiếu `vetch`, thử `an-array-of-english-words`, hoặc danh sách
"Wordle allowed guesses" (~14.855 từ) kèm attribution rõ ràng.

---

## 4. Kiến trúc & cấu trúc repo

Ràng buộc: **JavaScript thuần (ESM), Node ≥ 20, không build step, không TypeScript, không framework,
runtime zero-dependency** (dùng `fetch` và test runner `node:test` có sẵn trong Node). Lý do: buổi
live coding — mỗi giây chờ `tsc`/vite là một giây mất điểm, và mọi dòng code bạn đều phải giải thích được.

> Đây là điều chỉnh có chủ ý so với `plan-phan-tich.md` (đề xuất TypeScript + Vitest). Với repo ~8
> file nhỏ, type annotation và một test runner ngoài không đổi lại được chi phí setup trong phiên ghi
> hình. Dùng JSDoc typedef nếu muốn có type hint trong IDE.

```
votee-wordle-solver/
├── package.json              # type:module, scripts, chỉ devDependencies
├── README.md
├── .gitignore                # node_modules
├── data/
│   └── words5.txt            # ~15k từ, 1 từ mỗi dòng (committed)
├── scripts/
│   └── build-words.mjs       # dev-only, sinh data/words5.txt
├── src/
│   ├── api.js                # 3 oracle → response đã normalize
│   ├── feedback.js           # luật scoring (bản local, mirror API)
│   ├── filter.js             # lọc candidate theo feedback
│   ├── strategy.js           # chọn guess tiếp theo
│   ├── solver.js             # game loop, oracle-agnostic
│   ├── words.js              # load + validate từ điển
│   └── cli.js                # parse arg, render output
└── test/
    ├── feedback.test.js
    ├── filter.test.js
    ├── strategy.test.js
    ├── solver.test.js        # offline, gồm benchmark
    └── api.test.js           # integration, opt-in (env VOTEE_LIVE=1)
```

Tổng ~450–550 dòng code. Mỗi file một trách nhiệm, đọc là hiểu.

### Data shape dùng xuyên suốt (chốt cứng, không đổi)

```
Letter   : ký tự 'a'..'z'
Mark     : 'absent' | 'present' | 'correct'
Feedback : Mark[]   // độ dài = size, index = slot. KHÔNG dùng lại {slot,guess,result} của API
                    // ở tầng trong — normalize ngay tại api.js.
Oracle   : async (guess: string) => Feedback
```

Quy tắc quan trọng: **`api.js` là biên giới duy nhất biết đến hình dạng response của Votee.** Mọi
module khác chỉ thấy `Mark[]`. Nhờ vậy solver test được hoàn toàn offline.

---

## 5. Spec từng module (contract, không phải code)

### 5.1 `src/api.js`

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

### 5.2 `src/feedback.js`

| Hàm | Signature | Hành vi |
| --- | --- | --- |
| `score` | `(guess: string, target: string) => Feedback` | Implement **đúng** luật mục 2, per-slot |

Đây là bản mô phỏng local của server. Dùng cho: benchmark offline, và (quan trọng) một test đối
chiếu chạy thật với `/word/{target}` để chứng minh mô hình của ta khớp API.

### 5.3 `src/filter.js`

| Hàm | Signature | Hành vi |
| --- | --- | --- |
| `isConsistent` | `(candidate, guess, feedback) => boolean` | true nếu `candidate` có thể là target |
| `filterCandidates` | `(candidates: string[], guess, feedback) => string[]` | lọc danh sách |

Cách implement `isConsistent` **được khuyến nghị mạnh**: `score(guess, candidate)` bằng đúng
`feedback` (so sánh từng phần tử). Một dòng, không thể sai lệch so với server, và không cần viết
tay các luật ràng buộc riêng lẻ.

> Vì sao không dùng model "constraint" (fixed/required/forbidden/position-restriction) như
> `plan-phan-tich.md` mô tả? Vì với luật per-slot, `score`-so-khớp là **tương đương về mặt logic**
> nhưng ngắn hơn nhiều và không thể lệch khỏi server. Nếu vẫn muốn có phần "giải thích ràng buộc"
> cho đẹp khi demo, hãy làm nó ở tầng **hiển thị** (`cli.js`) — dẫn xuất ra "đã biết: `_ i _ _ y`,
> phải có: `e,r`, loại: `a,s,o,u`" **chỉ để in ra**, không dùng cho việc lọc. Tách rõ "logic" và
> "narrative" như vậy là một điểm cộng thiết kế.

### 5.4 `src/strategy.js`

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

Guess mở đầu: **không hardcode `slate`.** Hãy tính bằng chính `pickGuess` trên toàn từ điển và
**cache lại** (tính một lần khi khởi động, hoặc ghi vào `data/opening.json`). Vì với luật per-slot
và từ điển của ta, từ mở đầu tối ưu có thể khác `slate` — và "tôi *tính ra* nó" nghe hay hơn hẳn
"tôi đọc thấy trên mạng". Nếu tính lâu > 300ms thì cache.

**Nâng cấp tuỳ chọn (chỉ làm nếu còn thời gian — Milestone 7):** `--strategy=minimax`. Với mỗi
guess ứng viên, nhóm các candidate theo `score(guess, candidate)`, lấy kích thước nhóm lớn nhất
(worst case), chọn guess **nhỏ nhất** giá trị đó. Đây là information gain thực thụ. Chi phí
O(|G|·|C|·n) ⇒ chỉ bật khi `candidates.length ≤ 300` (sau lượt 1 luôn thoả), lượt 1 dùng opening
đã cache. Giữ heuristic tần suất làm mặc định; minimax là flag để so sánh trong benchmark.

### 5.5 `src/words.js`

| Hàm | Signature | Hành vi |
| --- | --- | --- |
| `loadWords` | `(size = 5) => string[]` | đọc `data/words5.txt`, filter đúng `size`, lowercase, unique |

Nếu `size !== 5` mà không có từ điển tương ứng ⇒ throw message rõ ràng ("chỉ hỗ trợ size 5, đã có
`data/words5.txt`; sinh thêm bằng `npm run build:words`"). Đừng cố hỗ trợ mọi size trong bản đầu.

### 5.6 `src/solver.js`

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

### 5.7 `src/cli.js`

```
node src/cli.js --mode random [--seed 12345] [--size 5] [--strategy freq|minimax]
node src/cli.js --mode daily
node src/cli.js --mode word --target apple
node src/cli.js --mode bench [--count 200] [--seed 1]
```

Parse arg **thủ công** bằng `process.argv` (hoặc `node:util` `parseArgs`) — không thêm `yargs`/`commander`.

Yêu cầu output (buổi live được ghi hình, output chính là phần thuyết trình của bạn):

```
Votee Wordle Solver
mode=random  size=5  seed=48213      ← seed PHẢI in ra, để reproduce được
dictionary: 15,342 words

#1  crane      c a p a a        known: c _ _ _ _   must have: n   ruled out: a,r,e
    candidates: 15,342 → 41
#2  ...

SOLVED  "fiery"  in 4 guesses
```

Bắt buộc: in `seed`, in số candidate còn lại sau mỗi lượt (đây là bằng chứng thuật toán đang hoạt
động), và tô màu bằng ANSI escape thuần (`\x1b[42m`…) — **không** thêm `chalk`.

Exit code: `0` nếu giải được, `1` nếu hết lượt, `2` nếu lỗi API/từ điển.

---

## 6. Chiến lược test

Nguyên tắc: **toàn bộ logic test được offline, không cần mạng.** Test mạng tách riêng và opt-in
(mạng sập giữa buổi live thì `npm test` vẫn xanh).

### 6.1 `feedback.test.js` — dùng chính các case đã verify với server thật

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

### 6.2 `filter.test.js`

- Target thật luôn nằm trong danh sách sau khi lọc (property test: với 100 target ngẫu nhiên và 100
  guess ngẫu nhiên, `isConsistent(target, guess, score(guess, target))` luôn true).
- `absent` loại bỏ mọi từ chứa chữ đó ở **bất kỳ** vị trí.
- `present` loại từ có chữ đó ở đúng vị trí đã đoán.
- Sau khi lọc bằng feedback all-correct, còn lại đúng 1 từ.

### 6.3 `strategy.test.js`

- Deterministic: gọi 2 lần cùng input ⇒ cùng output.
- `candidates.length === 1` ⇒ trả về chính từ đó.
- Guess được chọn có nhiều chữ phân biệt hơn phương án chữ lặp, khi điểm tần suất xấp xỉ nhau.

### 6.4 `solver.test.js` — quan trọng nhất

Dựng một **oracle offline** từ `score()` (chính là `createWordOracle` nhưng local). Rồi:

- Giải đúng 4 ground truth: `fiery`, `wrote`, `poise`, `vetch`.
- **Benchmark**: 300 từ lấy mẫu deterministic từ từ điển. Assert:
  - tỉ lệ giải trong 6 lượt **≥ 99%**
  - số lượt trung bình **≤ 4.2** (mốc thực tế cho heuristic tần suất; minimax nên xuống ~3.6)
  - in ra phân bố `1..6 lượt` — số này đưa vào README rất đẹp
- Nếu assert fail ⇒ **không nới lỏng ngưỡng**. Xem lại từ điển hoặc strategy.

### 6.5 `api.test.js` — integration, chỉ chạy khi `VOTEE_LIVE=1`

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
| 0 | `npm init`, `package.json` (`type:module`), `.gitignore`, `scripts/build-words.mjs`, sinh `data/words5.txt`, **verify tiêu chí mục 3** | 10' | Có từ điển đã kiểm chứng |
| 1 | `feedback.js` + `feedback.test.js` (bảng 6.1) | 10' | Luật scoring đúng, có test xanh |
| 2 | `filter.js` + test | 8' | Lọc được candidate |
| 3 | `strategy.js` (heuristic tần suất) + test | 12' | Chọn được guess |
| 4 | `solver.js` + `solver.test.js` với oracle offline | 12' | **Giải được offline — demo đầu tiên** |
| 5 | `api.js` + `cli.js`, mode `word` rồi `daily` rồi `random` | 15' | **Giải được puzzle thật qua mạng** |
| 6 | Benchmark + `api.test.js` contract test | 10' | Có số liệu cho README |
| 7 | *(tuỳ chọn)* `--strategy=minimax`, so sánh benchmark | 15' | Điểm cộng |
| 8 | README theo mục 9 | 15' | Sẵn sàng submit |

Nếu thời gian phiên ghi hình bị bó: milestone 0–5 là **bắt buộc**; 6 và 8 làm được offline sau;
7 bỏ được.

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
| Rate limit / 429 | Thấp (chưa thấy) | Xử lý trong retry logic của `api.js` |
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
11. **Testing** — offline vs live, cách chạy live (`VOTEE_LIVE=1`).
12. **Attribution** — nguồn từ điển + license; The Dodgy Engineer; 3Blue1Brown; NYT Wordle tips;
    ghi rõ AI assistance đã dùng và phần nào là quyết định của bạn. Email nói rõ về plagiarism —
    minh bạch ở đây là *cộng điểm*, không phải trừ.
13. **Limitations & future work** — chỉ size 5; heuristic không optimal; chưa dùng entropy đầy đủ /
    two-step lookahead; dictionary gap.

---

## 10. Definition of Done

- [ ] `npm test` xanh, không cần mạng.
- [ ] `VOTEE_LIVE=1 npm test` xanh, gồm contract test đối chiếu `score()` với API thật.
- [ ] `--mode random` không truyền seed: in seed ra và giải được.
- [ ] `--mode daily` giải được.
- [ ] `--mode word --target vetch` giải được (từ hiếm).
- [ ] Benchmark ≥ 99% giải trong 6 lượt, trung bình ≤ 4.2 lượt.
- [ ] Runtime `dependencies` = **rỗng**.
- [ ] Tổng LOC `src/` < 600, không file nào > 120 dòng.
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

Web UI · React/Next · TypeScript + build step · `chalk`/`yargs`/`axios`/`commander`/`lodash` ·
dropdown "chọn endpoint" · nhiều lớp abstraction (interface/factory/DI container) · file sinh tự
động khổng lồ · LLM bên trong solver · Docker · hardcode `seed` trong logic solver ·
hardcode opening word · copy-paste code từ `optimizing-wordle.md`.
