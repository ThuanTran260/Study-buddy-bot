import http from 'http';
import { Client } from 'discord.js';
import { logger } from './logger';

let botClient: Client | null = null;
let serverInstance: http.Server | null = null;

// 🛡️ DUAL-LAYER RATE LIMITER CHO /health (CHỐNG DOS & CHỐNG TRÀN RAM)
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_GLOBAL_REQUESTS_PER_WINDOW = 60; // Trần toàn cục: 60 req/phút cho toàn server
const MAX_IP_REQUESTS_PER_WINDOW = 60; // Trần mỗi IP: 60 req/phút/IP
const MAX_MAP_ENTRIES = 100; // Khóa cứng trần Map: Tối đa 100 IPs trong RAM

let globalCount = 0;
let globalResetTime = Date.now() + RATE_LIMIT_WINDOW_MS;

const ipRequestCounts = new Map<string, { count: number; resetTime: number }>();

export function isHealthRateLimited(ip: string): boolean {
  const now = Date.now();

  // 1. Tầng 1: Global Rate Limiter (Chống tấn công thay đổi IP / XFF Spoofing)
  if (now > globalResetTime) {
    globalCount = 1;
    globalResetTime = now + RATE_LIMIT_WINDOW_MS;
  } else {
    globalCount++;
    if (globalCount > MAX_GLOBAL_REQUESTS_PER_WINDOW) {
      return true;
    }
  }

  // 2. Tầng 2: Per-IP Rate Limiter kèm Khóa Trần Bộ Nhớ (Chống Memory Exhaustion)
  const record = ipRequestCounts.get(ip);

  if (!record || now > record.resetTime) {
    // Nếu Map chạm trần 100 entries, xóa entry cũ nhất để bảo vệ RAM 512MB
    if (ipRequestCounts.size >= MAX_MAP_ENTRIES) {
      const oldestKey = ipRequestCounts.keys().next().value;
      if (oldestKey) ipRequestCounts.delete(oldestKey);
    }

    ipRequestCounts.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  record.count++;
  if (record.count > MAX_IP_REQUESTS_PER_WINDOW) {
    return true;
  }

  return false;
}

// Reset rate limiter state (phục vụ test và dọn dẹp)
export function resetHealthRateLimiter(): void {
  globalCount = 0;
  globalResetTime = Date.now() + RATE_LIMIT_WINDOW_MS;
  ipRequestCounts.clear();
}

// Dọn dẹp Map mỗi 5 phút để tránh memory leak
if (process.env.NODE_ENV !== 'test') {
  const cleanupInterval = setInterval(
    () => {
      const now = Date.now();
      for (const [ip, record] of ipRequestCounts.entries()) {
        if (now > record.resetTime) {
          ipRequestCounts.delete(ip);
        }
      }
    },
    5 * 60 * 1000
  );
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

    // 🛡️ A4: Bóc tách IP an toàn (Lấy IP cuối do proxy uy tín thêm vào hoặc socket remoteAddress)
    const forwarded = req.headers['x-forwarded-for'] as string | undefined;
    const clientIp = forwarded
      ? forwarded.split(',').pop()?.trim() || req.socket.remoteAddress || 'unknown'
      : req.socket.remoteAddress || 'unknown';

    if (isHealthRateLimited(clientIp)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too Many Requests' }));
      return;
    }

    const isReady = botClient?.isReady() ?? false;
    if (req.method === 'HEAD') {
      res.writeHead(isReady ? 200 : 503);
      res.end();
      return;
    }

    // 🛡️ A1 & B: Response tối giản, TUYỆT ĐỐI KHÔNG lộ version, số guilds hay thông tin nội bộ
    if (isReady) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'not_ready' }));
    }
  });

  serverInstance.listen(port, '0.0.0.0', () => {
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
