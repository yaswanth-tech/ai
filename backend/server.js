const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const fs = require("fs");
const { apiLimiter } = require("./middleware/rateLimiter");
const { requireAuth, requireCandidate } = require('./middleware/authMiddleware');
const prisma = require('./utils/prismaClient');

/* ================= INIT APP FIRST ================= */
const app = express();
const PORT = Number(process.env.PORT || 3002);

const allowedOrigins = (process.env.CORS_ORIGINS || `http://localhost:${PORT}`)
  .split(',').map(origin => origin.trim()).filter(Boolean);

/* ================= MIDDLEWARE ================= */
// Existing pages use inline scripts; keep the other Helmet protections while CSP is migrated page-by-page.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin(origin, callback) {
    if (
      !origin ||
      allowedOrigins.includes(origin) ||
      origin.endsWith('.vercel.app') ||
      origin.includes('localhost') ||
      origin.includes('127.0.0.1')
    ) {
      return callback(null, true);
    }
    const error = new Error('Origin is not allowed by CORS: ' + origin);
    error.status = 403;
    return callback(error);
  },
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/api', apiLimiter);

app.get('/api/health', async (req, res) => {
  if (!process.env.DATABASE_URL) {
    return res.status(503).json({
      success: false,
      error: 'Database configuration is missing. Set DATABASE_URL in backend/.env.'
    });
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ success: true, database: 'connected' });
  } catch {
    res.status(503).json({ success: false, error: 'Database connection is unavailable.' });
  }
});

// Request Logger
app.use((req, res, next) => {
  console.log(JSON.stringify({ at: new Date().toISOString(), method: req.method, path: req.path }));
  next();
});

/* ================= ROUTES ================= */
const authRoutes = require('./routes/authRoutes');
const interviewRoutes = require('./routes/interviewRoutes');
const testRoutes = require('./routes/testRoutes');
const commRoutes = require('./routes/commRoutes');
const atsRoutes = require('./routes/atsRoutes');
const opportunityRoutes = require('./routes/opportunityRoutes');
const roadmapRoutes = require('./routes/roadmapRoutes');
const diagnosisRoutes = require('./routes/diagnosisRoutes');
const userRoutes = require('./routes/userRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');

// MOUNT ROUTES (Both /api/* and /* aliases for local & serverless compatibility)
app.use('/api/auth', authRoutes);
app.use('/auth', authRoutes);

app.use('/api/interview', interviewRoutes);
app.use('/interview', interviewRoutes);

app.use('/api/test', testRoutes);
app.use('/test', testRoutes);

app.use('/api/comm', commRoutes);
app.use('/comm', commRoutes);

app.use('/api/ats', atsRoutes);
app.use('/ats', atsRoutes);

app.use('/api/opportunities', opportunityRoutes);
app.use('/opportunities', opportunityRoutes);

app.use('/api/roadmaps', roadmapRoutes);
app.use('/roadmaps', roadmapRoutes);

app.use('/api/diagnosis', diagnosisRoutes);
app.use('/diagnosis', diagnosisRoutes);

app.use('/api/user', userRoutes);
app.use('/user', userRoutes);

app.use('/api/dashboard', dashboardRoutes);
app.use('/dashboard', dashboardRoutes);

// Direct download aliases for generated resumes & reports
app.get('/api/resume/download/:filename', requireAuth, requireCandidate, (req, res) => {
  res.redirect(302, `/api/ats/download/${encodeURIComponent(path.basename(req.params.filename))}`);
});

app.get('/api/reports/download/:filename', requireAuth, requireCandidate, (req, res) => {
  res.redirect(302, `/api/ats/download/${encodeURIComponent(path.basename(req.params.filename))}`);
});

/* ================= UPLOAD DIRECTORIES ================= */
const uploadDirs = ['uploads', 'uploads/resumes', 'uploads/generated', 'uploads/reports'];
uploadDirs.forEach(dir => {
  try {
    const dirPath = (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)
      ? path.join('/tmp', dir)
      : path.join(__dirname, dir);
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  } catch (err) {
    // Non-fatal on serverless environments where fs is read-only
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/home.html'));
});

/* ================= STATIC FILES ================= */
app.use(express.static(path.join(__dirname, "../frontend")));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error && (error.name === 'MulterError' || error.code === 'LIMIT_FILE_SIZE')) {
    const oversized = error.code === 'LIMIT_FILE_SIZE';
    const message = oversized ? 'The uploaded file exceeds the 5 MiB limit.' : 'The uploaded file could not be accepted.';
    return res.status(oversized ? 413 : 400).json({ success: false, error: message });
  }
  const status = Number.isInteger(error.status) ? error.status : 500;
  console.error(JSON.stringify({ at: new Date().toISOString(), event: 'request_error', method: req.method, path: req.path, status }));
  res.status(status).json({ success: false, error: status >= 500 ? 'The request could not be completed.' : error.message });
});

module.exports = app;

/* ================= START SERVER ================= */
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    const aiProvider = process.env.AI_PROVIDER || 'openai';
    const aiModel = process.env.AI_MODEL || process.env.OPENAI_MODEL || 'gpt-6-luna';
    const hasKey = aiProvider === 'openai' ? Boolean(process.env.OPENAI_API_KEY) : Boolean(process.env.GEMINI_API_KEY);
    const aiAvailable = process.env.AI_ENABLED === 'true' && aiProvider === 'openai' && hasKey;

    console.log(`✅ ASCEND Backend running at http://localhost:${PORT}`);
    console.log(`   - AI Engine: ${aiAvailable ? `OPENAI (${aiModel})` : 'Deterministic rule-based fallback (AI disabled or unavailable)'}`);
    console.log(`   - Database: PostgreSQL via Prisma`);
    console.log(`   - Authentication: JWT + Hashed Passwords`);
  });
}
