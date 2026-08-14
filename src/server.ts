import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDailyOracle, createRandomOracle, createWordOracle } from './api.ts';
import { solve } from './solver.ts';
import { loadOpening, loadWords } from './words.ts';
import type { Oracle } from './types.ts';
import type { StrategyName } from './strategy.ts';

/**
 * HTTP layer mỏng để UI trong browser dùng lại ĐÚNG solver của CLI — không viết lại thuật
 * toán bằng JS phía client, vì hai bản code sẽ lệch nhau và test chỉ phủ được một bản.
 *
 * Không dùng framework: `node:http` là đủ cho hai endpoint.
 */
const PORT = Number(process.env['PORT'] ?? 3000);
const WEB_DIR = join(import.meta.dirname, '..', 'web');

const words = loadWords(5);
const firstGuess = loadOpening();

const randomSeed = (): number => Math.floor(Math.random() * 1_000_000) + 1;

function buildOracle(params: URLSearchParams): { oracle: Oracle; seed?: number } {
  const mode = params.get('mode') ?? 'random';
  const size = Number(params.get('size') ?? 5);

  switch (mode) {
    case 'daily':
      return { oracle: createDailyOracle(size) };
    case 'word': {
      const target = params.get('target');
      if (!target) throw new Error('mode=word cần tham số target');
      return { oracle: createWordOracle(target) };
    }
    case 'random': {
      // Thiếu seed thì mỗi request là một từ khác nhau, nên ghim một seed cho cả phiên.
      const seed = params.get('seed') ? Number(params.get('seed')) : randomSeed();
      return { oracle: createRandomOracle(seed, size), seed };
    }
    default:
      throw new Error(`mode không hợp lệ: ${mode}`);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  // Cho phép mở index.html bằng Live Server ở origin khác mà vẫn gọi được API này.
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    if (url.pathname === '/api/solve') {
      const { oracle, seed } = buildOracle(url.searchParams);
      const strategy = (url.searchParams.get('strategy') ?? 'entropy') as StrategyName;
      const result = await solve({ oracle, words, strategy, firstGuess });

      return json(res, 200, { ...result, seed, dictionarySize: words.length });
    }

    if (url.pathname === '/api/guess') {
      const guess = url.searchParams.get('guess');
      if (!guess) throw new Error('cần tham số guess');
      const { oracle, seed } = buildOracle(url.searchParams);

      return json(res, 200, { guess, feedback: await oracle(guess), seed });
    }

    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const body = await readFile(join(WEB_DIR, file));
    res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain' });
    return res.end(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // ENOENT là xin file không có; còn lại coi là tham số sai.
    return json(res, message.includes('ENOENT') ? 404 : 400, { error: message });
  }
});

function json(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

/**
 * Mặc định Node ném stack trace cho EADDRINUSE, khiến nguyên nhân thật bị chôn: một server cũ
 * còn sống với code cũ trong bộ nhớ, nên mọi sửa đổi trông như không có tác dụng.
 */
server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EADDRINUSE') throw error;
  console.error(
    `\nPort ${PORT} đang bị một tiến trình khác giữ — gần như chắc chắn là server cũ chưa tắt.\n` +
      `Nó vẫn chạy CODE CŨ trong bộ nhớ, nên sửa file sẽ không có tác dụng gì.\n\n` +
      `  Windows : Get-NetTCPConnection -LocalPort ${PORT} -State Listen | %{ Stop-Process -Id $_.OwningProcess -Force }\n` +
      `  macOS   : kill -9 $(lsof -ti tcp:${PORT})\n` +
      `  hoặc    : PORT=${PORT + 1} npm run web\n`,
  );
  process.exit(1);
});

server.listen(PORT, () => console.log(`\nVotee Wordle Solver — http://localhost:${PORT}\n`));
