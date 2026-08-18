import http from 'http';
import { Client } from 'discord.js';
import { logger } from './logger';

let botClient: Client | null = null;
let serverInstance: http.Server | null = null;

export function registerHealthClient(client: Client): void {
  botClient = client;
}

export function startHealthServer(port: number = 3000): http.Server {
  serverInstance = http.createServer((req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404);
      res.end();
      return;
    }

    const isReady = botClient?.isReady() ?? false;
    if (isReady) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', guilds: botClient?.guilds.cache.size }));
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
