const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { resetDb } = require('./helpers');
const app = require('../src/server');
const db = require('../src/db');

describe('Auth Routes (src/routes/auth.js & src/middleware/auth.js)', () => {
  let server;
  let baseUrl;

  before(async () => {
    // Clean all tables safely before auth tests
    resetDb(db);
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });

  test('POST /api/auth/register creates user and returns 201 with lowercased email', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: ' Alice Smith ',
        email: 'Alice.Smith@Example.COM ',
        password: 'Password123!',
      }),
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(typeof data.id, 'number');
    assert.strictEqual(data.name, 'Alice Smith');
    assert.strictEqual(data.email, 'alice.smith@example.com');

    // Confirm password in DB is hashed and not plaintext
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(data.id);
    assert.ok(row);
    assert.notStrictEqual(row.password_hash, 'Password123!');
    assert.ok(row.password_hash.startsWith('$2'));
  });

  test('POST /api/auth/register rejects duplicate email with 409', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Alice Duplicate',
        email: 'alice.smith@example.com',
        password: 'AnotherPassword123!',
      }),
    });

    assert.strictEqual(res.status, 409);
    const data = await res.json();
    assert.ok(data.error);
    assert.match(data.error, /already registered/i);
  });

  test('POST /api/auth/register rejects invalid inputs with 400', async () => {
    // Missing password
    const res1 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bob',
        email: 'bob@example.com',
      }),
    });
    assert.strictEqual(res1.status, 400);

    // Short password (< 8 chars)
    const res2 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bob',
        email: 'bob@example.com',
        password: 'short',
      }),
    });
    assert.strictEqual(res2.status, 400);

    // Unknown field (strict rejection)
    const res3 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bob',
        email: 'bob@example.com',
        password: 'ValidPassword123!',
        isAdmin: true,
      }),
    });
    assert.strictEqual(res3.status, 400);
  });

  test('POST /api/auth/login succeeds with valid credentials and sets session cookie', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'ALICE.SMITH@EXAMPLE.COM',
        password: 'Password123!',
      }),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.email, 'alice.smith@example.com');
    assert.strictEqual(data.name, 'Alice Smith');

    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie, 'Expected Set-Cookie header');
    assert.match(setCookie, /session=[^;]+/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
  });

  test('POST /api/auth/login fails with generic 401 for wrong password', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'alice.smith@example.com',
        password: 'WrongPassword!',
      }),
    });

    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.error, 'Invalid email or password');
  });

  test('POST /api/auth/login fails with generic 401 for non-existent email', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'ghost@example.com',
        password: 'AnyPassword123!',
      }),
    });

    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.error, 'Invalid email or password');
  });

  test('GET /api/auth/me returns 401 when no session cookie is provided', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`);
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.ok(data.error);
  });

  test('GET /api/auth/me returns 200 {id, name, email} when valid session cookie is provided', async () => {
    // 1. Log in to get session cookie
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'alice.smith@example.com',
        password: 'Password123!',
      }),
    });
    const setCookie = loginRes.headers.get('set-cookie');
    const cookieValue = setCookie.split(';')[0];

    // 2. Call /me with the session cookie
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: cookieValue },
    });

    assert.strictEqual(meRes.status, 200);
    const meData = await meRes.json();
    assert.strictEqual(meData.email, 'alice.smith@example.com');
    assert.strictEqual(meData.name, 'Alice Smith');
    assert.strictEqual(typeof meData.id, 'number');
  });

  test('POST /api/auth/logout clears session cookie and returns 204', async () => {
    const res = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
    });

    assert.strictEqual(res.status, 204);
    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie);
    assert.match(setCookie, /session=;/);
  });
});
