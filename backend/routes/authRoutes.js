const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../utils/prismaClient');
const { requireAuth, getJwtSecret } = require('../middleware/authMiddleware');
const { authLimiter } = require('../middleware/rateLimiter');

function getAuthConfigurationError() {
  if (!process.env.DATABASE_URL) {
    return 'Database configuration is missing. Set DATABASE_URL in backend/.env.';
  }
  if (!getJwtSecret()) {
    return 'Server authentication is not configured. Set JWT_SECRET in backend/.env.';
  }
  return null;
}

function getAuthFailure(error, fallbackError) {
  const code = error?.errorCode || error?.code;
  if (code === 'P2002') {
    return { status: 409, error: 'An account with this email already exists.' };
  }

  const databaseConnectionCodes = new Set([
    'P1000', 'P1001', 'P1002', 'P1003', 'P1008', 'P1010', 'P1011',
    'P1013', 'P1017', 'P2024'
  ]);
  if (error?.name === 'PrismaClientInitializationError' || databaseConnectionCodes.has(code)) {
    return {
      status: 503,
      error: 'Database is unavailable. Check DATABASE_URL, PostgreSQL availability, and network access.'
    };
  }

  if (code === 'P2021' || code === 'P2022') {
    return {
      status: 503,
      error: 'The database schema is not up to date. Apply the reviewed Prisma migrations.'
    };
  }

  return { status: 500, error: fallbackError };
}

// Helper to generate JWT token (expires in 7 days)
function generateToken(user) {
  const secret = getJwtSecret();
  if (!secret) {
    const error = new Error('Server authentication is not configured. Set JWT_SECRET in backend/.env.');
    error.status = 500;
    throw error;
  }
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    secret,
    { expiresIn: '7d' }
  );
}

/**
 * POST /api/auth/signup
 * Creates a new user with hashed password
 */
router.post('/signup', authLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ success: false, error: 'Full name is required (min 2 characters).' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email.trim())) {
      return res.status(400).json({ success: false, error: 'A valid email address is required.' });
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' });
    }

    const configurationError = getAuthConfigurationError();
    if (configurationError) return res.status(503).json({ success: false, error: configurationError });

    const normalizedEmail = email.trim().toLowerCase();

    // Check if email already registered (case‑insensitive)
    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });
    if (existing) {
      return res.status(409).json({ success: false, error: 'An account with this email already exists.' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        passwordHash
      },
      select: {
        id: true,
        name: true,
        email: true,
        tourCompleted: true,
        createdAt: true
      }
    });

    const token = generateToken(user);

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      token,
      user
    });
  } catch (error) {
    const failure = getAuthFailure(error, 'Failed to create account.');
    console.error(JSON.stringify({
      event: 'signup_failed',
      status: failure.status,
      errorCode: error?.errorCode || error?.code
    }));
    res.status(failure.status).json({ success: false, error: failure.error });
  }
});

/**
 * POST /api/auth/login
 * Verifies email/password and returns JWT token
 */
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, username, password } = req.body;
    // Normalise identifier – prioritize explicit email field for clarity
    const identifier = (email || username || '').trim().toLowerCase();

    if (!identifier || !password) {
      return res.status(400).json({ success: false, error: 'Email/username and password are required.' });
    }

    const configurationError = getAuthConfigurationError();
    if (configurationError) return res.status(503).json({ success: false, error: configurationError });

    // Prefer email lookup for deterministic behaviour
    let user = await prisma.user.findUnique({
      where: { email: identifier }
    });
    // Fallback to username (stored in name) if not found by email
    if (!user) {
      user = await prisma.user.findFirst({
        where: {
          name: { equals: identifier, mode: 'insensitive' }
        }
      });
    }

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    if (!user.passwordHash) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      tourCompleted: user.tourCompleted
    };

    const token = generateToken(safeUser);

    res.json({
      success: true,
      message: 'Logged in successfully',
      token,
      user: safeUser
    });
  } catch (error) {
    const failure = getAuthFailure(error, 'Login failed due to a server error.');
    console.error(JSON.stringify({
      event: 'login_failed',
      status: failure.status,
      errorCode: error?.errorCode || error?.code
    }));
    res.status(failure.status).json({ success: false, error: failure.error });
  }
});

/**
 * GET /api/auth/me
 * Retrieves current authenticated user profile
 */
router.get('/me', requireAuth, async (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

module.exports = router;
