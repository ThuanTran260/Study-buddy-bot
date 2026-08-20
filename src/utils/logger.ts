type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const entry = { timestamp, level, message, ...context };
  if (level === 'error') {
    console.error(safeStringify(entry));
  } else {
    console.log(safeStringify(entry));
  }
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => log('debug', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => log('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => log('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => log('error', msg, ctx),
};
