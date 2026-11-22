/**
 * In-memory fixed-window limiter for login attempts (single API instance).
 * Keys: ip+identifier (5/min) and ip (30/min — a whole shop shares one NAT IP).
 */
export class LoginRateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly perIdentifier = 5,
    private readonly perIp = 30,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns true if the attempt is allowed (and records it). */
  attempt(ip: string, identifier: string): boolean {
    const t = this.now();
    if (this.hits.size > 10_000) this.sweep(t);
    const a = this.bump(`id:${ip}:${identifier.toLowerCase()}`, t);
    const b = this.bump(`ip:${ip}`, t);
    return a <= this.perIdentifier && b <= this.perIp;
  }

  /** Clear the identifier bucket after a successful login. */
  reset(ip: string, identifier: string): void {
    this.hits.delete(`id:${ip}:${identifier.toLowerCase()}`);
  }

  private bump(key: string, t: number): number {
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= t) {
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
      return 1;
    }
    cur.count += 1;
    return cur.count;
  }

  private sweep(t: number): void {
    for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
  }
}
