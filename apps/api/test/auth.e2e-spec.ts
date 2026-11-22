import { createTestApp, PASSWORDS, TestCtx, uniq } from './helpers';

describe('Authentication, sessions and seed users', () => {
  let t: TestCtx;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const login = (identifier: string, password: string, extra: object = {}) =>
    t.http().post('/api/v1/auth/login').send({ identifier, password, client: 'mobile', ...extra });

  it('all 12 seeded users can log in with the expected roles', async () => {
    const expected: Record<string, string> = { superadmin: 'SUPER_ADMIN', admin01: 'ADMIN', admin02: 'ADMIN' };
    for (let i = 1; i <= 9; i++) expected[`seller0${i}`] = 'SALESPERSON';
    expect(Object.keys(expected)).toHaveLength(12);
    for (const [username, role] of Object.entries(expected)) {
      const res = await login(username, PASSWORDS[username]);
      expect(res.status).toBe(200);
      expect(res.body.data.user.role).toBe(role);
      expect(res.body.data.refreshToken).toBeDefined();
    }
  });

  it('logs in by email (case-insensitive)', async () => {
    const res = await login('ADMIN01@KITE.LOCAL', PASSWORDS.admin01);
    expect(res.status).toBe(200);
    expect(res.body.data.user.username).toBe('admin01');
  });

  it('rejects a wrong password with a generic message and never leaks the hash', async () => {
    const res = await login('admin01', 'wrong-password-1');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    const unknown = await login('nobody-here', 'wrong-password-1');
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(res.body.error.message);
    const ok = await login('admin01', PASSWORDS.admin01);
    expect(JSON.stringify(ok.body)).not.toMatch(/argon2|passwordHash/);
  });

  it('forces a password change for new users and enforces the policy', async () => {
    const admin = t.api(await t.token('admin01'));
    const username = uniq('u').toLowerCase();
    const created = await admin.post('/users', {
      username,
      email: `${username}@kite.local`,
      fullName: 'Temp Seller',
      role: 'SALESPERSON',
      password: 'TempPass#123',
    });
    expect(created.status).toBe(201);
    const l = await login(username, 'TempPass#123');
    expect(l.body.data.user.mustChangePassword).toBe(true);
    const api = t.api(l.body.data.accessToken);
    expect((await api.get('/products')).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await api.get('/auth/me')).status).toBe(200);
    const weak = await api.post('/auth/change-password', { currentPassword: 'TempPass#123', newPassword: 'short' });
    expect(weak.status).toBe(400);
    const ok = await api.post('/auth/change-password', { currentPassword: 'TempPass#123', newPassword: 'BetterPass#2026' });
    expect(ok.status).toBe(200);
    const after = t.api(ok.body.data.accessToken);
    expect((await after.get('/products')).status).toBe(200);
    // the pre-change session was revoked
    expect((await api.get('/auth/me')).body.error.code).toBe('SESSION_REVOKED');
  });

  it('rotates refresh tokens and revokes the whole family on reuse', async () => {
    const l = await login('seller02', PASSWORDS.seller02);
    const rt1 = l.body.data.refreshToken;
    const r1 = await t.http().post('/api/v1/auth/refresh').send({ refreshToken: rt1 });
    expect(r1.status).toBe(200);
    const rt2 = r1.body.data.refreshToken;
    expect(rt2).not.toBe(rt1);
    // wait past the concurrency grace window, then replay the stolen old token
    await new Promise((r) => setTimeout(r, 5200));
    const reuse = await t.http().post('/api/v1/auth/refresh').send({ refreshToken: rt1 });
    expect(reuse.status).toBe(401);
    // the legitimate newer token is now revoked too
    const r2 = await t.http().post('/api/v1/auth/refresh').send({ refreshToken: rt2 });
    expect(r2.status).toBe(401);
    const [audit] = await t.ds.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'AUTH_REFRESH_REUSE'`);
    expect(audit.n).toBeGreaterThan(0);
  });

  it('CRM logins receive the refresh token only as an httpOnly cookie', async () => {
    const res = await login('admin02', PASSWORDS.admin02, { client: 'crm' });
    expect(res.status).toBe(200);
    expect(res.body.data.refreshToken).toBeUndefined();
    const cookie = res.headers['set-cookie'][0] as string;
    expect(cookie).toMatch(/kite_rt=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    const refreshed = await t.http().post('/api/v1/auth/refresh').set('Cookie', cookie.split(';')[0]).send({});
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).toBeDefined();
    expect(refreshed.body.data.refreshToken).toBeUndefined();
  });

  it('logout revokes the session immediately', async () => {
    const l = await login('seller03', PASSWORDS.seller03);
    const api = t.api(l.body.data.accessToken);
    expect((await api.get('/auth/me')).status).toBe(200);
    await api.post('/auth/logout', { refreshToken: l.body.data.refreshToken });
    expect((await api.get('/auth/me')).status).toBe(401);
  });

  it('deactivating a user blocks their existing token on the next request', async () => {
    const admin = t.api(await t.token('admin01'));
    const username = uniq('d').toLowerCase();
    const created = await admin.post('/users', { username, email: `${username}@kite.local`, fullName: 'To Disable', role: 'SALESPERSON', password: 'TempPass#123' });
    const l = await login(username, 'TempPass#123');
    const api = t.api(l.body.data.accessToken);
    expect((await api.get('/auth/me')).status).toBe(200);
    expect((await admin.post(`/users/${created.body.data.id}/deactivate`)).status).toBe(200);
    expect((await api.get('/auth/me')).status).toBe(401);
    expect((await login(username, 'TempPass#123')).body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('locks an account after 10 failed attempts', async () => {
    const admin = t.api(await t.token('admin01'));
    const username = uniq('l').toLowerCase();
    await admin.post('/users', { username, email: `${username}@kite.local`, fullName: 'Lock Me', role: 'SALESPERSON', password: 'TempPass#123' });
    for (let i = 0; i < 10; i++) await login(username, 'bad-password-x1');
    const res = await login(username, 'TempPass#123');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('admins cannot manage other admins; super admin can', async () => {
    const admin = t.api(await t.token('admin01'));
    const sa = t.api(await t.token('superadmin'));
    const users = (await sa.get('/users?role=ADMIN')).body.data;
    const admin02 = users.find((u: { username: string }) => u.username === 'admin02');
    expect((await admin.post(`/users/${admin02.id}/revoke-sessions`)).status).toBe(403);
    const username = uniq('a').toLowerCase();
    expect((await admin.post('/users', { username, email: `${username}@kite.local`, fullName: 'Not Allowed', role: 'ADMIN', password: 'TempPass#123' })).status).toBe(403);
    expect((await sa.post('/users', { username, email: `${username}@kite.local`, fullName: 'New Admin', role: 'ADMIN', password: 'TempPass#123' })).status).toBe(201);
  });

  it('the seeder is idempotent (running again keeps exactly 12 seed users)', async () => {
    const { runDevSeed } = await import('../src/database/seeds/dev-seed');
    await runDevSeed(t.ds, { mustChangePassword: false });
    await runDevSeed(t.ds, { mustChangePassword: false });
    const [r] = await t.ds.query(
      `SELECT count(*)::int AS n FROM users WHERE email LIKE '%@kite.local' AND username IN ('superadmin','admin01','admin02','seller01','seller02','seller03','seller04','seller05','seller06','seller07','seller08','seller09')`,
    );
    expect(r.n).toBe(12);
    const [c] = await t.ds.query(`SELECT count(*)::int AS n FROM product_categories`);
    expect(c.n).toBeGreaterThanOrEqual(9);
    const [h] = await t.ds.query(`SELECT count(*)::int AS n FROM users WHERE password_hash NOT LIKE '$argon2id$%'`);
    expect(h.n).toBe(0);
  });
});
