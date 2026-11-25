const assert = require('assert');
const express = require('express');
const jwt = require('jsonwebtoken');
const prisma = require('../utils/prismaClient');
const { questionCountForDuration } = require('../utils/interviewFlow');
const interviewRoutes = require('../routes/interviewRoutes');

async function runInterviewFlowTests() {
  const secretName = 'JWT_SECRET';
  const originalSecret = process.env[secretName];
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const methods = [
    [prisma, '$transaction'],
    [prisma.user, 'findUnique'],
    [prisma.interviewSession, 'create'],
    [prisma.interviewSession, 'findUnique'],
    [prisma.interviewSession, 'update'],
    [prisma.interviewSession, 'updateMany'],
    [prisma.questionAttempt, 'create'],
    [prisma.activityLog, 'create']
  ];
  const originals = methods.map(([model, method]) => model[method]);
  const sessions = new Map();
  const attempts = new Map();
  const activityWrites = [];
  let sessionNumber = 0;
  const clone = value => JSON.parse(JSON.stringify(value));

  process.env[secretName] = 'interview-flow-test-secret-at-least-24-chars';
  process.env.DATABASE_URL = 'postgresql://interview-test:interview-test@localhost:5432/interview_test';
  prisma.$transaction = async operation => operation(prisma);
  prisma.user.findUnique = async ({ where }) => ({
    id: where.id,
    name: 'Test Candidate',
    email: `${where.id}@example.test`,
    role: 'CANDIDATE'
  });
  prisma.interviewSession.create = async ({ data }) => {
    const id = `session-${++sessionNumber}`;
    const session = {
      id,
      activityLoggedAt: null,
      currentQuestionIndex: 0,
      totalScore: 0,
      ...clone(data),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    sessions.set(id, session);
    attempts.set(id, []);
    return clone(session);
  };
  prisma.interviewSession.findUnique = async ({ where }) => {
    const session = sessions.get(where.id);
    return session ? { ...clone(session), attempts: clone(attempts.get(where.id) || []) } : null;
  };
  prisma.interviewSession.update = async ({ where, data }) => {
    const session = sessions.get(where.id);
    if (!session) throw new Error('Session missing');
    for (const [key, value] of Object.entries(data)) {
      if (key === 'totalScore' && value?.increment !== undefined) session.totalScore += value.increment;
      else session[key] = clone(value);
    }
    return clone(session);
  };
  prisma.interviewSession.updateMany = async ({ where, data }) => {
    const session = sessions.get(where.id);
    if (!session || (where.userId && session.userId !== where.userId)) return { count: 0 };
    if (where.status?.not && session.status === where.status.not) return { count: 0 };
    if (typeof where.status === 'string' && session.status !== where.status) return { count: 0 };
    if (where.currentQuestionIndex !== undefined && session.currentQuestionIndex !== where.currentQuestionIndex) return { count: 0 };
    if (where.activityLoggedAt === null && session.activityLoggedAt !== null) return { count: 0 };
    for (const [key, value] of Object.entries(data)) {
      if (key === 'totalScore' && value?.increment !== undefined) session.totalScore += value.increment;
      else session[key] = clone(value);
    }
    return { count: 1 };
  };
  prisma.questionAttempt.create = async ({ data }) => {
    const attempt = { id: `attempt-${(attempts.get(data.sessionId) || []).length + 1}`, ...clone(data) };
    attempts.get(data.sessionId).push(attempt);
    return clone(attempt);
  };
  prisma.activityLog.create = async ({ data }) => {
    activityWrites.push(clone(data));
    return { id: `activity-${activityWrites.length}` };
  };

  const app = express();
  app.use(express.json());
  app.use('/api/interview', interviewRoutes);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/interview`;
  const tokenFor = id => jwt.sign({ id }, process.env[secretName], { expiresIn: '5m' });
  const headersFor = id => ({
    authorization: `Bearer ${tokenFor(id)}`,
    'content-type': 'application/json'
  });
  const request = async (path, userId, method = 'GET', body) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: userId ? headersFor(userId) : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, json: await response.json() };
  };

  try {
    assert.strictEqual(questionCountForDuration(10), 5);
    assert.strictEqual(questionCountForDuration(20), 8);
    assert.strictEqual(questionCountForDuration(30), 12);

    const unauthorized = await request('/missing/state');
    assert.strictEqual(unauthorized.status, 401, 'unauthenticated requests are rejected');

    const start = await request('/start-session', 'candidate-1', 'POST', {
      role: 'Python Developer',
      type: 'TECHNICAL',
      experience: '1-3',
      difficulty: 'hard',
      duration: '20',
      userId: 'attacker-selected-user'
    });
    assert.strictEqual(start.status, 201);
    assert.strictEqual(start.json.plannedQuestionCount, 8);
    const session = sessions.get(start.json.sessionId);
    assert.strictEqual(session.userId, 'candidate-1', 'session owner is taken from the authenticated user');
    assert.strictEqual(session.role, 'Python Developer');
    assert.strictEqual(session.experience, '1-3');
    assert.strictEqual(session.difficulty, 'hard');
    assert.strictEqual(session.plannedQuestions[0].id, 'intro_q1');
    assert.strictEqual(new Set(session.plannedQuestions.map(question => question.id)).size, 8, 'question plans contain no duplicates');
    assert(session.plannedQuestions.slice(1).every(question => question.difficulty), 'dataset questions have a difficulty tag');

    const denied = await request(`/${session.id}/state`, 'candidate-2');
    assert.strictEqual(denied.status, 404, 'users cannot read another candidate session');

    const started = await request(`/${session.id}/begin`, 'candidate-1', 'POST', {});
    assert.strictEqual(started.status, 200);
    assert(started.json.data.startedAt);
    assert(started.json.data.deadlineAt);
    const resumed = await request(`/${session.id}/state`, 'candidate-1');
    assert.strictEqual(resumed.json.data.startedAt, started.json.data.startedAt);
    assert.strictEqual(resumed.json.data.deadlineAt, started.json.data.deadlineAt, 'resuming preserves the original server deadline');
    const wrongQuestion = await request(`/${session.id}/submit-answer`, 'candidate-1', 'POST', {
      questionId: session.plannedQuestions[1].id,
      answer: 'A sufficiently complete answer.'
    });
    assert.strictEqual(wrongQuestion.status, 409);
    assert.strictEqual(attempts.get(session.id).length, 0);

    const intro = await request(`/${session.id}/submit-answer`, 'candidate-1', 'POST', {
      questionId: session.plannedQuestions[0].id,
      answer: 'I am excited to learn and contribute to the team.'
    });
    assert.strictEqual(intro.status, 200);
    assert(attempts.get(session.id)[0].score < 10, 'the introduction is evaluated instead of receiving an automatic perfect score');
    assert(attempts.get(session.id)[0].exampleAnswer);
    assert(Array.isArray(attempts.get(session.id)[0].missingKeywords));
    assert(Number.isInteger(attempts.get(session.id)[0].timeTakenSeconds));

    const longRoleStart = await request('/start-session', 'candidate-1', 'POST', {
      role: 'Full Stack Developer',
      type: 'TECHNICAL',
      experience: '3+',
      difficulty: 'hard',
      duration: '30'
    });
    assert.strictEqual(longRoleStart.json.plannedQuestionCount, 12, 'a long interview gets its full plan even for a smaller role-specific dataset');
    const longPlan = sessions.get(longRoleStart.json.sessionId).plannedQuestions;
    assert.strictEqual(new Set(longPlan.map(question => question.id)).size, 12);

    const shortStart = await request('/start-session', 'candidate-1', 'POST', {
      role: 'Python Developer',
      type: 'TECHNICAL',
      experience: 'fresher',
      difficulty: 'easy',
      duration: '10'
    });
    const shortId = shortStart.json.sessionId;
    await request(`/${shortId}/begin`, 'candidate-1', 'POST', {});
    const firstQuestion = sessions.get(shortId).plannedQuestions[0];
    const skipped = await request(`/${shortId}/skip`, 'candidate-1', 'POST', {
      questionId: sessions.get(shortId).plannedQuestions[0].id
    });
    assert.strictEqual(skipped.status, 200, JSON.stringify(skipped.json));
    const reportResult = await request(`/${shortId}/end-session`, 'candidate-1', 'POST', {});
    assert.strictEqual(reportResult.status, 200);
    assert.strictEqual(reportResult.json.data.plannedQuestionCount, 5);
    assert.strictEqual(reportResult.json.data.answered, 0);
    assert.strictEqual(reportResult.json.data.skipped, 1);
    assert.strictEqual(reportResult.json.data.unanswered, 4);
    assert.strictEqual(reportResult.json.data.totalScore, 0, 'unanswered questions contribute zero against the planned total');
    assert.strictEqual(attempts.get(shortId).length, 5);
    assert.strictEqual(attempts.get(shortId)[0].questionId, firstQuestion.id);
    assert.strictEqual(activityWrites.filter(entry => entry.metadata.sessionId === shortId).length, 1);
    const writesAfterEnd = activityWrites.length;
    const repeatedEnd = await request(`/${shortId}/end-session`, 'candidate-1', 'POST', {});
    assert.strictEqual(repeatedEnd.status, 200);
    assert.strictEqual(activityWrites.length, writesAfterEnd, 'ending an already completed interview does not log activity twice');
    const afterCompletion = await request(`/${shortId}/submit-answer`, 'candidate-1', 'POST', {
      questionId: firstQuestion.id,
      answer: 'A late answer.'
    });
    assert.strictEqual(afterCompletion.status, 409);

    const timedStart = await request('/start-session', 'candidate-1', 'POST', {
      role: 'Python Developer',
      type: 'TECHNICAL',
      experience: '3+',
      difficulty: 'medium',
      duration: '10'
    });
    const timedId = timedStart.json.sessionId;
    await request(`/${timedId}/begin`, 'candidate-1', 'POST', {});
    sessions.get(timedId).deadlineAt = new Date(Date.now() - 1000).toISOString();
    const expired = await request(`/${timedId}/state`, 'candidate-1');
    assert.strictEqual(expired.status, 200);
    assert.strictEqual(expired.json.data.status, 'COMPLETED');
    assert.strictEqual(expired.json.data.report.endReason, 'TIME_UP');
    assert.strictEqual(expired.json.data.report.unanswered, 5);

    console.log('✔ Interview plan, auth/ownership, answer validation, completion, idempotency, timeout, and unanswered scoring passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    methods.forEach(([model, method], index) => {
      model[method] = originals[index];
    });
    if (originalSecret === undefined) delete process.env[secretName];
    else process.env[secretName] = originalSecret;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
}

module.exports = runInterviewFlowTests;
if (require.main === module) runInterviewFlowTests();
