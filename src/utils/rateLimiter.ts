interface RateLimitEntry {
  count: number;
  windowStart: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
  message?: string;
}

export class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private cleanupInterval: NodeJS.Timeout;

  constructor({ maxRequests, windowMs }: { maxRequests: number; windowMs: number }) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store.entries()) {
        if (now - entry.windowStart > this.windowMs) {
          this.store.delete(key);
        }
      }
    }, this.windowMs);
    this.cleanupInterval.unref();
  }

  check(userId: string): RateLimitResult {
    const now = Date.now();
    const entry = this.store.get(userId);

    if (!entry || now - entry.windowStart > this.windowMs) {
      this.store.set(userId, { count: 1, windowStart: now });
      return { allowed: true };
    }

    if (entry.count < this.maxRequests) {
      entry.count += 1;
      return { allowed: true };
    }

    const retryAfterMs = this.windowMs - (now - entry.windowStart);
    const retryAfterMin = Math.ceil(retryAfterMs / 60_000);

    return {
      allowed: false,
      retryAfterMs,
      message: `⏳ Bạn đã dùng ${entry.count}/${this.maxRequests} lượt. Hãy thử lại sau **${retryAfterMin} phút**.`,
    };
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
  }
}

export const aiRateLimiter = new RateLimiter({ maxRequests: 10, windowMs: 3_600_000 });
export const quizRateLimiter = new RateLimiter({ maxRequests: 5, windowMs: 3_600_000 });
