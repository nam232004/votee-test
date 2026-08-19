import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createDailyOracle, createRandomOracle, createWordOracle } from './api.ts';
import { solve } from './solver.ts';
import type { GuessStrategy } from './strategy.ts';
import type { Oracle } from './types.ts';
import { loadOpening, loadWords } from './words.ts';

const PORT = Number(process.env['PORT']) || 3000;
const INDEX = path.join(import.meta.dirname, '..', 'web', 'index.html');

function cors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function send(res: ServerResponse, status: number, body: string, type: string): void {
  cors(res);
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  send(res, status, JSON.stringify(payload), 'application/json; charset=utf-8');
}

function error(res: ServerResponse, status: number, message: string): void {
  json(res, status, { error: message });
}

function randomSeed(): number {
  return 1 + Math.floor(Math.random() * 2_147_483_646);
}

function parseSeed(raw: string | null): number | undefined {
  if (raw === null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error('seed must be a non-negative integer');
  }
  return n;
}

async function handleSolve(url: URL, res: ServerResponse): Promise<void> {
  const mode = url.searchParams.get('mode') ?? 'random';
  const strategyRaw = url.searchParams.get('strategy') ?? 'entropy';
  if (strategyRaw !== 'entropy' && strategyRaw !== 'minimax' && strategyRaw !== 'freq') {
    error(res, 400, `Unknown strategy "${strategyRaw}"`);
    return;
  }
  const strategy = strategyRaw as GuessStrategy;

  let seed: number | null = null;
  let oracle: Oracle;

  try {
    if (mode === 'random') {
      seed = parseSeed(url.searchParams.get('seed')) ?? randomSeed();
      oracle = createRandomOracle(seed);
    } else if (mode === 'daily') {
      oracle = createDailyOracle();
    } else if (mode === 'word') {
      const target = url.searchParams.get('target')?.trim() ?? '';
      if (!target) {
        error(res, 400, 'mode=word requires target');
        return;
      }
      oracle = createWordOracle(target);
    } else {
      error(res, 400, `Unknown mode "${mode}". Use random, daily, or word.`);
      return;
    }
  } catch (err) {
    error(res, 400, err instanceof Error ? err.message : 'Invalid request');
    return;
  }

  const words = await loadWords(5);
  const firstGuess = (await loadOpening()) ?? 'tares';
  const result = await solve({ oracle, words, strategy, firstGuess });
  json(res, 200, { ...result, seed, dictionarySize: words.length });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const host = req.headers.host ?? `localhost:${PORT}`;
  const url = new URL(req.url ?? '/', `http://${host}`);

  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = await readFile(INDEX, 'utf8');
      send(res, 200, html, 'text/html; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/solve') {
      await handleSolve(url, res);
      return;
    }
    error(res, 404, 'Not found');
  } catch (err) {
    error(res, 500, err instanceof Error ? err.message : 'Internal server error');
  }
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use. An old server is still running and will keep serving old code.`,
    );
    console.error(`Windows:  netstat -ano | findstr :${PORT}   then  taskkill /PID <pid> /F`);
    console.error(`Unix:     lsof -i :${PORT}   then  kill <pid>`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`Votee solver UI at http://localhost:${PORT}`);
});
