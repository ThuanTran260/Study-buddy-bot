import { RateLimiter } from '../../src/utils/rateLimiter';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({ maxRequests: 2, windowMs: 1000 });
  });

  afterEach(() => {
    limiter.destroy();
  });

  it('allows requests within limit and blocks when exceeded', () => {
    expect(limiter.check('user1').allowed).toBe(true);
    expect(limiter.check('user1').allowed).toBe(true);
    const blocked = limiter.check('user1');
    expect(blocked.allowed).toBe(false);
    expect(blocked.message).toContain('Bạn đã dùng 2/2 lượt');
  });

  it('tracks distinct users independently', () => {
    limiter.check('userA');
    limiter.check('userA');
    expect(limiter.check('userA').allowed).toBe(false);
    expect(limiter.check('userB').allowed).toBe(true);
  });
});
