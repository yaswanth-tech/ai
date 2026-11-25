const jwt = require('jsonwebtoken');
const prisma = require('../utils/prismaClient');

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 24) return null;
  if (/change_in_production|your_jwt_secret|replace_with/i.test(secret)) return null;
  return secret;
}

/**
 * Middleware that requires a valid JWT token
 */
async function requireAuth(req, res, next) {
  try {
    const secret = getJwtSecret();
    if (!secret) {
      return res.status(503).json({
        success: false,
        error: 'Server authentication is not configured. Set JWT_SECRET in backend/.env.'
      });
    }
    if (!process.env.DATABASE_URL) {
      return res.status(503).json({
        success: false,
        error: 'Database configuration is missing. Set DATABASE_URL in backend/.env.'
      });
    }

    const authHeader = req.headers.authorization || req.headers['x-auth-token'];
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (authHeader) {
      token = authHeader;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Please log in.'
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
        return res.status(401).json({
          success: false,
          error: 'Your session has expired. Please log in again.'
        });
      }

      console.error('Unexpected error while verifying authentication token:', error);
      return res.status(500).json({
        success: false,
        error: 'Server error while checking your session.'
      });
    }

    let user;
    try {
      user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, name: true, email: true, tourCompleted: true, role: true }
      });
    } catch (error) {
      console.error('Error while loading authenticated user:', error);
      return res.status(500).json({
        success: false,
        error: 'Server error while checking your session.'
      });
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User account no longer exists.'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired authentication token.'
    });
  }
}

/**
 * Middleware that extracts user if token exists, but doesn't block guests
 */
async function optionalAuth(req, res, next) {
  try {
    const secret = getJwtSecret();
    if (!secret) return next();

    const authHeader = req.headers.authorization || req.headers['x-auth-token'];
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (authHeader) {
      token = authHeader;
    }

    if (token) {
      const decoded = jwt.verify(token, secret);
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, name: true, email: true, tourCompleted: true, role: true }
      });
      if (user) {
        req.user = user;
      }
    }
  } catch (e) {
    // ignore token errors for optional auth
  }
  next();
}

function requireCandidate(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required.' });
  if (req.user.role !== 'CANDIDATE') return res.status(403).json({ success: false, error: 'Candidate access required.' });
  next();
}

module.exports = { requireAuth, optionalAuth, requireCandidate, getJwtSecret };
