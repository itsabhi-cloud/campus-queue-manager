/**
 * Small in-memory fixed-window rate limiter. Suitable for a single API instance; a multi-instance
 * deployment should move this to Redis (documented in docs/security.md).
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  /** Returns 0 when allowed, otherwise the number of milliseconds until the caller may retry. */
  consume(key: string, now = Date.now()): number {
    const current = this.hits.get(key);
    if (!current || current.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      this.sweep(now);
      return 0;
    }
    current.count += 1;
    return current.count > this.limit ? current.resetAt - now : 0;
  }

  reset(key: string) {
    this.hits.delete(key);
  }

  clear() {
    this.hits.clear();
  }

  private sweep(now: number) {
    if (this.hits.size < 5000) return;
    this.hits.forEach((value, key) => {
      if (value.resetAt <= now) this.hits.delete(key);
    });
  }
}

export const limiters = {
  loginByIp: new RateLimiter(30, 10 * 60_000),
  activationByIp: new RateLimiter(20, 10 * 60_000),
  mutationsByUser: new RateLimiter(240, 60_000),
  cameraByStation: new RateLimiter(40, 60_000),
};
