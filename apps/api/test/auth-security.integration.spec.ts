import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import pg from 'pg';
import * as argon2 from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.INVENTORY_TEST_DATABASE_URL;
if (!url || new URL(url).hostname !== '127.0.0.1' || !/^stockledger_test_[a-f0-9]{32}$/.test(new URL(url).pathname.slice(1))) throw new Error('Use isolated local integration runner');
const db = new pg.Client({ connectionString: url });
const blocker = new pg.Client({ connectionString: url });
let app: INestApplication, base: string;
const password = 'InitialPassword123!';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
async function request(path: string, body?: unknown, token?: string, cookie?: string, method = 'POST') {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
beforeAll(async () => {
  await db.connect(); await blocker.connect();
  const compiled = '../dist/app.module.js';
  const { AppModule } = await import(compiled);
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1'); base = await app.getUrl();
});
afterAll(async () => { if (app) await app.close(); await blocker.end(); await db.end(); });
async function fixture(role = 'administrator') {
  const company = randomUUID(), id = randomUUID(), token = `${company}.${randomBytes(32).toString('hex')}`, email = `${id}@test.invalid`;
  await db.query("INSERT INTO companies(id,name,updated_at) VALUES ($1,'Auth race',now())", [company]);
  await db.query(`INSERT INTO users(id,company_id,full_name,email,password_hash,role,email_verified_at,invitation_accepted_at,updated_at) VALUES ($1,$2,'Test account',$3,$4,$5,now(),now(),now())`, [id, company, email, await argon2.hash(password), role]);
  return { company, id, token, email };
}
// Both HTTP requests must reach PostgreSQL while a separate connection holds
// the user row. This exercises overlapping transactions, not sequential promises.
async function concurrent(id: string, actions: (() => ReturnType<typeof request>)[]) {
  await blocker.query('BEGIN');
  await blocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [id]);
  const pending = Promise.all(actions.map(action => action()));
  try {
    await expect.poll(async () => Number((await db.query("SELECT count(*) n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")).rows[0].n), { timeout: 5000, interval: 20 }).toBeGreaterThanOrEqual(2);
  } finally { await blocker.query('COMMIT'); }
  return pending;
}
describe('atomic one-use account links over concurrent HTTP requests', () => {
  it('accepts an invitation once and creates exactly one usable session', async () => {
    const f = await fixture('inventory_manager');
    await db.query("UPDATE users SET invitation_token_hash=$2, invitation_expires_at=now()+interval '1 hour', invitation_accepted_at=null WHERE id=$1", [f.id, hash(f.token)]);
    const results = await concurrent(f.id, ['FirstPassword123!', 'SecondPassword123!'].map(newPassword => () => request('/auth/invitations/accept', { token: f.token, newPassword })));
    expect(results.map(r => r.status).sort()).toEqual([200, 400]);
    expect(Number((await db.query('SELECT count(*) n FROM refresh_sessions WHERE user_id=$1', [f.id])).rows[0].n)).toBe(1);
    const winner = results.find(r => r.status === 200)!;
    expect((await request('/auth/me', undefined, winner.body.accessToken, undefined, 'GET')).status).toBe(200);
    const stored = (await db.query('SELECT password_hash FROM users WHERE id=$1', [f.id])).rows[0].password_hash;
    expect(await argon2.verify(stored, results[0].status === 200 ? 'FirstPassword123!' : 'SecondPassword123!')).toBe(true);
  });
  it('reports success for only the reset that consumed the token', async () => {
    const f = await fixture();
    await db.query("UPDATE users SET password_reset_token_hash=$2, password_reset_expires_at=now()+interval '1 hour' WHERE id=$1", [f.id, hash(f.token)]);
    const results = await concurrent(f.id, ['FirstPassword123!', 'SecondPassword123!'].map(newPassword => () => request('/auth/password/reset', { token: f.token, newPassword })));
    expect(results.map(r => r.status).sort()).toEqual([200, 400]);
    expect(Number((await db.query("SELECT count(*) n FROM audit_events WHERE actor_user_id=$1 AND action='account.password_reset'", [f.id])).rows[0].n)).toBe(1);
  });
  it('verifies an email once and creates only the winning session', async () => {
    const f = await fixture();
    await db.query("UPDATE users SET email_verification_token_hash=$2, email_verification_expires_at=now()+interval '1 hour',email_verified_at=null WHERE id=$1", [f.id, hash(f.token)]);
    const results = await concurrent(f.id, [() => request('/auth/email/verify', { token: f.token }), () => request('/auth/email/verify', { token: f.token })]);
    expect(results.map(r => r.status).sort()).toEqual([200, 400]);
    expect(Number((await db.query('SELECT count(*) n FROM refresh_sessions WHERE user_id=$1', [f.id])).rows[0].n)).toBe(1);
  });
});

describe('access token session revocation', () => {
  const login = (email: string) => request('/auth/login', { email, password });
  const write = (token: string) => request('/auth/me', { fullName: 'Changed name', email: `${randomUUID()}@test.invalid` }, token, undefined, 'PATCH');
  it('rejects a protected write immediately after logout, preserving another session', async () => {
    const f = await fixture();
    const a = await login(f.email), b = await login(f.email);
    expect(a.status).toBe(200); expect(b.status).toBe(200);
    expect((await request('/auth/logout', undefined, undefined, a.cookie)).status).toBe(200);
    expect((await write(a.body.accessToken)).status).toBe(401);
    expect((await write(b.body.accessToken)).status).toBe(200);
  });
  it('keeps session binding across refresh rotation and revokes the old and new access tokens together', async () => {
    const f = await fixture(); const a = await login(f.email);
    const rotated = await request('/auth/refresh', undefined, undefined, a.cookie);
    expect(rotated.status).toBe(200);
    expect((await request('/auth/logout', undefined, undefined, rotated.cookie)).status).toBe(200);
    expect((await write(a.body.accessToken)).status).toBe(401);
    expect((await write(rotated.body.accessToken)).status).toBe(401);
  });
  it('revokes access for every session on password reset', async () => {
    const f = await fixture(); const a = await login(f.email);
    await db.query("UPDATE users SET password_reset_token_hash=$2,password_reset_expires_at=now()+interval '1 hour' WHERE id=$1", [f.id, hash(f.token)]);
    expect((await request('/auth/password/reset', { token: f.token, newPassword: 'ResetPassword123!' })).status).toBe(200);
    expect((await write(a.body.accessToken)).status).toBe(401);
  });
  it('revokes access for every session on password change', async () => {
    const f = await fixture(); const a = await login(f.email);
    expect((await request('/auth/me/password', { currentPassword: password, newPassword: 'ChangedPassword123!' }, a.body.accessToken, undefined, 'PATCH')).status).toBe(200);
    expect((await write(a.body.accessToken)).status).toBe(401);
  });
  it('enforces explicit session revocation on protected writes', async () => {
    const f = await fixture(); const a = await login(f.email);
    const session = (await db.query('SELECT id FROM refresh_sessions WHERE user_id=$1', [f.id])).rows[0].id;
    expect((await request(`/auth/sessions/${session}`, undefined, a.body.accessToken, undefined, 'DELETE')).status).toBe(200);
    expect((await write(a.body.accessToken)).status).toBe(401);
  });
});
