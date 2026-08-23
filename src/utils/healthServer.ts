import http from 'http';
import { Client } from 'discord.js';
import { logger } from './logger';

let botClient: Client | null = null;
let serverInstance: http.Server | null = null;

// 🛡️ In-memory sliding window rate limiter cho /health (60 req/phút/IP)
const ipRequestCounts = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 60;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = ipRequestCounts.get(ip);

  if (!record || now > record.resetTime) {
    ipRequestCounts.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  record.count++;
  if (record.count > MAX_REQUESTS_PER_WINDOW) {
    return true;
  }

  return false;
}

// Dọn dẹp IP rate limiter map mỗi 5 phút để tránh memory leak
if (process.env.NODE_ENV !== 'test') {
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of ipRequestCounts.entries()) {
      if (now > record.resetTime) {
        ipRequestCounts.delete(ip);
      }
    }
  }, 5 * 60 * 1000);
  cleanupInterval.unref();
}

export function registerHealthClient(client: Client): void {
  botClient = client;
}

export function startHealthServer(port: number = 3000): http.Server {
  serverInstance = http.createServer((req, res) => {
    // 🛡️ A2: Chỉ chấp nhận phương thức GET và HEAD
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method Not Allowed' }));
      return;
    }

    // 🛡️ B: Thu hẹp bề mặt tấn công - Chỉ mở duy nhất /health và /
    const urlPath = (req.url || '').split('?')[0];
    if (urlPath !== '/health' && urlPath !== '/') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
      return;
    }

    // 🛡️ A4: Rate limit nhẹ nhàng theo IP (60 req/min)
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    if (isRateLimited(clientIp)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too Many Requests' }));
      return;
    }

    if (req.method === 'HEAD') {
      res.writeHead(200);
      res.end();
      return;
    }

    // 🛡️ A1 & B: Response tối giản, TUYỆT ĐỐI KHÔNG lộ version, số guilds hay thông tin nội bộ
    const isReady = botClient?.isReady() ?? false;
    if (isReady) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'not_ready' }));
    }
  });

  serverInstance.listen(port, () => {
    logger.info('Health check server started', { port });
  });

  return serverInstance;
}

export function closeHealthServer(): Promise<void> {
  return new Promise((resolve) => {
    if (serverInstance) {
      serverInstance.close(() => resolve());
    } else {
      resolve();
    }
  });
}
