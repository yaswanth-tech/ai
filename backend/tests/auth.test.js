const assert = require('assert');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const express = require('express');
process.env.JWT_SECRET = 'unit-test-only-jwt-secret-32-characters';
const prisma = require('../utils/prismaClient');
const { getJwtSecret, requireAuth } = require('../middleware/authMiddleware');
const authRoutes = require('../routes/authRoutes');

async function invokeAuth(authorization) {
  const req = { headers: authorization ? { authorization } : {} };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
  let nextCalled = false;
  await requireAuth(req, res, () => { nextCalled = true; });
  return { req, res, nextCalled };
}

async function runAuthTests() {
  console.log('--- Running Authentication & Security Tests ---');

  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://auth-test:auth-test@localhost:5432/auth_test';
  const rawPassword = 'SecurePassword2026!';

  // Test 1: Password hashing and comparison
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(rawPassword, salt);
  assert.notStrictEqual(hash, rawPassword, 'Hash must not equal raw password');

  const match = await bcrypt.compare(rawPassword, hash);
  assert.strictEqual(match, true, 'bcrypt.compare must verify matching password');

  const wrongMatch = await bcrypt.compare('WrongPassword', hash);
  assert.strictEqual(wrongMatch, false, 'bcrypt.compare must reject wrong password');
  console.log('✔ Test 1: Password hashing and verification passed');

  // Test 2: JWT generation and verification
  const payload = { id: 'test_user_uuid', email: 'test@example.com', name: 'Tester' };
  const secret = getJwtSecret();
  const token = jwt.sign(payload, secret, { expiresIn: '1h' });
  assert(typeof token === 'string' && token.length > 20, 'JWT must be a valid token string');

  const decoded = jwt.verify(token, secret);
  assert.strictEqual(decoded.id, payload.id);
  assert.strictEqual(decoded.email, payload.email);
  console.log('✔ Test 2: JWT token signing and verification passed');

  const originalVerify = jwt.verify;
  const originalFindUnique = prisma.user.findUnique;
  const originalCreate = prisma.user.create;
  const originalConsoleError = console.error;
  try {
    const invalid = await invokeAuth('Bearer malformed-token');
    assert.strictEqual(invalid.res.statusCode, 401);
    assert.deepStrictEqual(invalid.res.body, {
      success: false,
      error: 'Your session has expired. Please log in again.'
    });

    jwt.verify = () => { throw new jwt.TokenExpiredError('jwt expired', new Date()); };
    const expired = await invokeAuth('Bearer expired-token');
    assert.strictEqual(expired.res.statusCode, 401);
    assert.strictEqual(expired.res.body.error, 'Your session has expired. Please log in again.');

    let loggedUnexpectedError = false;
    console.error = () => { loggedUnexpectedError = true; };
    jwt.verify = () => ({ id: 'test_user_uuid' });
    prisma.user.findUnique = async () => { throw new Error('test database failure'); };
    const databaseFailure = await invokeAuth('Bearer valid-shaped-token');
    assert.strictEqual(databaseFailure.res.statusCode, 500);
    assert.deepStrictEqual(databaseFailure.res.body, {
      success: false,
      error: 'Server error while checking your session.'
    });
    assert.strictEqual(loggedUnexpectedError, true, 'unexpected session lookup failures must be logged');

    prisma.user.findUnique = async () => ({ id: 'test_user_uuid', name: 'Tester' });
    const valid = await invokeAuth('Bearer valid-shaped-token');
    assert.strictEqual(valid.nextCalled, true);
    assert.strictEqual(valid.req.user.name, 'Tester');

    delete process.env.DATABASE_URL;
    jwt.verify = () => ({ id: 'test_user_uuid' });
    const missingDatabase = await invokeAuth('Bearer valid-shaped-token');
    assert.strictEqual(missingDatabase.res.statusCode, 503);
    assert.strictEqual(missingDatabase.res.body.error, 'Database configuration is missing. Set DATABASE_URL in backend/.env.');
    process.env.DATABASE_URL = 'postgresql://auth-test:auth-test@localhost:5432/auth_test';

    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);
    const server = await new Promise(resolve => {
      const instance = app.listen(0, () => resolve(instance));
    });
    try {
      const configuredJwtSecret = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;
      let response;
      try {
        response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'test@example.com', password: 'password-for-test' })
        });
      } finally {
        process.env.JWT_SECRET = configuredJwtSecret;
      }
      assert.strictEqual(response.status, 503);
      assert.strictEqual((await response.json()).error, 'Server authentication is not configured. Set JWT_SECRET in backend/.env.');

      process.env.JWT_SECRET = configuredJwtSecret;
      const databaseConnectionError = Object.assign(new Error('connection refused'), {
        name: 'PrismaClientInitializationError',
        errorCode: 'P1001'
      });
      prisma.user.findUnique = async () => { throw databaseConnectionError; };

      for (const [path, body] of [
        ['login', { email: 'test@example.com', password: 'password-for-test' }],
        ['signup', { name: 'Test User', email: 'new@example.com', password: 'password-for-test' }]
      ]) {
        const unavailableResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        });
        assert.strictEqual(unavailableResponse.status, 503);
        assert.strictEqual(
          (await unavailableResponse.json()).error,
          'Database is unavailable. Check DATABASE_URL, PostgreSQL availability, and network access.'
        );
      }

      prisma.user.findUnique = async () => null;
      prisma.user.create = async () => { throw Object.assign(new Error('unique constraint'), { code: 'P2002' }); };
      const duplicateResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Test User', email: 'duplicate@example.com', password: 'password-for-test' })
      });
      assert.strictEqual(duplicateResponse.status, 409);
      assert.strictEqual((await duplicateResponse.json()).error, 'An account with this email already exists.');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
    console.log('✔ Test 3: Session verification and login/signup database failures are reported accurately');
  } finally {
    jwt.verify = originalVerify;
    prisma.user.findUnique = originalFindUnique;
    prisma.user.create = originalCreate;
    console.error = originalConsoleError;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
}

module.exports = runAuthTests;

if (require.main === module) {
  runAuthTests().catch(console.error);
}
