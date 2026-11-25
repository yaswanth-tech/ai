const express = require('express');
const prisma = require('../utils/prismaClient');
const { requireAuth } = require('../middleware/authMiddleware');
const { buildQuestionPlan, questionCountForDuration } = require('../utils/interviewFlow');
const { evaluateAnswer } = require('../utils/keywordEvaluator');

const router = express.Router();
router.use(requireAuth);

function reportFor(session) {
  const attempts = session.attempts || [];
  const questionCount = session.plannedQuestionCount ||
    (session.plannedQuestions || []).length ||
    attempts.length;
  const totalScore = Number(session.totalScore || 0);
  const answered = attempts.filter(attempt => attempt.status === 'ANSWERED').length;
  const skipped = attempts.filter(attempt => attempt.status === 'SKIPPED').length;
  const unanswered = Math.max(0, questionCount - answered - skipped);
  const percentage = questionCount ? Math.round((totalScore / (questionCount * 10)) * 100) : 0;
  const strengths = attempts
    .filter(attempt => attempt.status === 'ANSWERED' && attempt.score >= 7)
    .map(attempt => attempt.questionText);
  const focusAreas = attempts
    .filter(attempt => attempt.status !== 'ANSWERED' || attempt.score < 7)
    .flatMap(attempt => attempt.missingKeywords || [])
    .filter((keyword, index, all) => all.indexOf(keyword) === index)
    .slice(0, 8);

  return {
    sessionId: session.id,
    role: session.role,
    type: session.type,
    experience: session.experience,
    difficulty: session.difficulty,
    durationMinutes: session.durationMinutes,
    plannedQuestionCount: questionCount,
    startedAt: session.startedAt,
    deadlineAt: session.deadlineAt,
    completedAt: session.completedAt,
    endReason: session.endReason,
    timeUsedSeconds: session.startedAt && session.completedAt
      ? Math.max(0, Math.floor((new Date(session.completedAt) - new Date(session.startedAt)) / 1000))
      : 0,
    totalScore,
    percentage,
    answered,
    skipped,
    unanswered,
    strengths,
    focusAreas,
    attempts
  };
}

async function findOwnedSession(sessionId, userId) {
  const session = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
    include: { attempts: { orderBy: { createdAt: 'asc' } } }
  });
  return session?.userId === userId ? session : null;
}

async function completeSession(session, reason) {
  const outcome = await prisma.$transaction(async tx => {
    const current = await tx.interviewSession.findUnique({
      where: { id: session.id },
      include: { attempts: { orderBy: { createdAt: 'asc' } } }
    });
    if (!current) throw new Error('Interview session disappeared while completing.');
    if (current.status === 'COMPLETED') return { finished: current, shouldLog: false };

    const now = new Date();
    const questions = current.plannedQuestions || [];
    const completion = await tx.interviewSession.updateMany({
      where: { id: current.id, userId: current.userId, status: { not: 'COMPLETED' } },
      data: {
        status: 'COMPLETED',
        currentStage: 'COMPLETED',
        endReason: reason,
        completedAt: now,
        currentQuestionIndex: questions.length
      }
    });
    if (!completion.count) {
      const finished = await tx.interviewSession.findUnique({
        where: { id: current.id },
        include: { attempts: { orderBy: { createdAt: 'asc' } } }
      });
      return { finished, shouldLog: false };
    }

    const attemptedIds = new Set((current.attempts || []).map(attempt => attempt.questionId));
    for (const question of questions.filter(item => !attemptedIds.has(item.id))) {
      await tx.questionAttempt.create({
        data: {
          sessionId: current.id,
          questionId: question.id,
          questionText: question.question,
          userAnswer: '',
          exampleAnswer: question.exampleAnswer || null,
          matchedKeywords: [],
          missingKeywords: question.expectedKeywords || [],
          score: 0,
          feedback: reason === 'TIME_UP'
            ? 'Time expired before this question was answered.'
            : 'No answer was submitted for this question.',
          timeTakenSeconds: 0,
          status: 'UNANSWERED'
        }
      });
    }
    const finished = await tx.interviewSession.findUnique({
      where: { id: current.id },
      include: { attempts: { orderBy: { createdAt: 'asc' } } }
    });
    const activityClaim = await tx.interviewSession.updateMany({
      where: { id: current.id, activityLoggedAt: null },
      data: { activityLoggedAt: now }
    });
    if (activityClaim.count > 0) {
      const report = reportFor(finished);
      await tx.activityLog.create({
        data: {
          userId: finished.userId,
          module: 'MockInterview',
          action: 'COMPLETE',
          summary: `Mock Interview (${finished.role}) completed - Score: ${report.percentage}%`,
          score: report.percentage,
          status: 'COMPLETED',
          metadata: {
            sessionId: finished.id,
            role: finished.role,
            type: finished.type,
            endReason: reason
          }
        }
      });
    }
    const finalized = await tx.interviewSession.findUnique({
      where: { id: current.id },
      include: { attempts: { orderBy: { createdAt: 'asc' } } }
    });
    return { finished: finalized };
  });
  return outcome.finished;
}

async function expireIfNeeded(session) {
  if (session.status === 'COMPLETED') return session;
  if (session.deadlineAt && new Date(session.deadlineAt).getTime() <= Date.now()) return completeSession(session, 'TIME_UP');
  if (session.currentQuestionIndex >= session.plannedQuestionCount) return completeSession(session, 'COMPLETED');
  return session;
}

function currentQuestion(session) {
  return (session.plannedQuestions || [])[session.currentQuestionIndex] || null;
}

function publicQuestion(question, index, total) {
  if (!question) return null;
  return { id: question.id, question: question.question, difficulty: question.difficulty, number: index + 1, total };
}

function stateFor(session) {
  return {
    sessionId: session.id,
    status: session.status,
    role: session.role,
    type: session.type,
    experience: session.experience,
    difficulty: session.difficulty,
    durationMinutes: session.durationMinutes,
    plannedQuestionCount: session.plannedQuestionCount || (session.plannedQuestions || []).length || (session.attempts || []).length,
    currentQuestionIndex: session.currentQuestionIndex,
    currentQuestion: publicQuestion(currentQuestion(session), session.currentQuestionIndex, session.plannedQuestionCount),
    startedAt: session.startedAt,
    deadlineAt: session.deadlineAt,
    serverNow: new Date().toISOString(),
    report: session.status === 'COMPLETED' ? reportFor(session) : null
  };
}

function sendError(res, error) {
  console.error(JSON.stringify({ event: 'interview_request_failed', message: error.message }));
  return res.status(500).json({ success: false, error: 'The interview request could not be completed.' });
}

router.post('/start-session', async (req, res) => {
  try {
    const { role, type, experience, difficulty, duration } = req.body || {};
    const durationMinutes = Number(duration);
    if (!['HR', 'TECHNICAL'].includes(type) ||
      !Number.isInteger(durationMinutes) ||
      ![10, 20, 30].includes(durationMinutes)) {
      return res.status(400).json({ success: false, error: 'Choose a valid interview type and duration.' });
    }
    if (type === 'TECHNICAL' && (typeof role !== 'string' || !role.trim())) {
      return res.status(400).json({ success: false, error: 'A target role is required for a technical interview.' });
    }
    if (!['fresher', '1-3', '3+'].includes(experience) ||
      !['easy', 'medium', 'hard'].includes(difficulty)) {
      return res.status(400).json({ success: false, error: 'Choose a valid experience and difficulty level.' });
    }
    const selectedRole = type === 'HR' ? 'General' : role.trim();
    const plannedQuestions = buildQuestionPlan({
      role: selectedRole, type, difficulty, experience, durationMinutes
    });
    const session = await prisma.interviewSession.create({
      data: {
        userId: req.user.id,
        type,
        role: selectedRole,
        experience,
        difficulty,
        durationMinutes,
        plannedQuestionCount: questionCountForDuration(durationMinutes),
        plannedQuestions,
        status: 'READY',
        currentStage: 'LOBBY',
        totalScore: 0
      }
    });
    return res.status(201).json({
      success: true,
      sessionId: session.id,
      plannedQuestionCount: session.plannedQuestionCount
    });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/:sessionId/begin', async (req, res) => {
  try {
    const session = await findOwnedSession(req.params.sessionId, req.user.id);
    if (!session) return res.status(404).json({ success: false, error: 'Interview session not found.' });
    if (session.status === 'COMPLETED') return res.status(409).json({ success: false, error: 'This interview is already complete.' });
    if (!session.startedAt) {
      const startedAt = new Date();
      await prisma.interviewSession.update({
        where: { id: session.id },
        data: {
          status: 'IN_PROGRESS',
          currentStage: 'INTERVIEW',
          startedAt,
          deadlineAt: new Date(startedAt.getTime() + session.durationMinutes * 60 * 1000),
          currentQuestionStartedAt: startedAt
        }
      });
    }
    const latest = await findOwnedSession(session.id, req.user.id);
    return res.json({ success: true, data: stateFor(latest) });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/:sessionId/state', async (req, res) => {
  try {
    let session = await findOwnedSession(req.params.sessionId, req.user.id);
    if (!session) return res.status(404).json({ success: false, error: 'Interview session not found.' });
    session = await expireIfNeeded(session);
    return res.json({ success: true, data: stateFor(session) });
  } catch (error) {
    return sendError(res, error);
  }
});

async function advanceQuestion(session, status, answer = '') {
  const question = currentQuestion(session);
  if (!question) return null;
  const now = new Date();
  const start = session.currentQuestionStartedAt || session.startedAt || now;
  const timeTakenSeconds = Math.max(0, Math.floor((now.getTime() - new Date(start).getTime()) / 1000));
  const evaluation = status === 'ANSWERED'
    ? evaluateAnswer(
      answer,
      question.expectedKeywords || [],
      question.weightage || {},
      session.currentQuestionIndex,
      question.feedbackTemplates,
      question.minLength,
      session.type === 'HR'
    )
    : {
      score: 0,
      matchedKeywords: [],
      missingKeywords: question.expectedKeywords || [],
      feedback: 'This question was skipped.'
    };

  const updated = await prisma.$transaction(async tx => {
    const moved = await tx.interviewSession.updateMany({
      where: {
        id: session.id,
        userId: session.userId,
        status: 'IN_PROGRESS',
        currentQuestionIndex: session.currentQuestionIndex
      },
      data: {
        totalScore: { increment: evaluation.score },
        currentQuestionIndex: session.currentQuestionIndex + 1,
        currentQuestionStartedAt: now
      }
    });
    if (!moved.count) {
      const conflict = new Error('This question has already been submitted or is no longer current.');
      conflict.statusCode = 409;
      throw conflict;
    }
    await tx.questionAttempt.create({
      data: {
        sessionId: session.id,
        questionId: question.id,
        questionText: question.question,
        userAnswer: status === 'ANSWERED' ? answer : '',
        exampleAnswer: question.exampleAnswer || null,
        matchedKeywords: evaluation.matchedKeywords || [],
        missingKeywords: evaluation.missingKeywords || [],
        score: evaluation.score,
        feedback: evaluation.feedback,
        timeTakenSeconds,
        status
      }
    });
    return tx.interviewSession.findUnique({
      where: { id: session.id },
      include: { attempts: { orderBy: { createdAt: 'asc' } } }
    });
  });
  return updated.currentQuestionIndex >= updated.plannedQuestionCount
    ? completeSession(updated, 'COMPLETED')
    : updated;
}

router.post('/:sessionId/submit-answer', async (req, res) => {
  try {
    let session = await findOwnedSession(req.params.sessionId, req.user.id);
    if (!session) return res.status(404).json({ success: false, error: 'Interview session not found.' });
    if (session.status === 'COMPLETED') return res.status(409).json({ success: false, error: 'This interview is already complete.' });
    session = await expireIfNeeded(session);
    if (session.status === 'COMPLETED') return res.status(409).json({ success: false, error: 'Interview time has expired.' });
    if (!session.startedAt) return res.status(409).json({ success: false, error: 'Begin the interview before submitting an answer.' });
    const question = currentQuestion(session);
    if (!question || req.body?.questionId !== question.id) {
      return res.status(409).json({ success: false, error: 'The answer must match the current question.' });
    }
    if (typeof req.body?.answer !== 'string' || !req.body.answer.trim()) {
      return res.status(400).json({ success: false, error: 'Enter or record an answer before submitting.' });
    }
    const updated = await advanceQuestion(session, 'ANSWERED', req.body.answer.trim());
    return res.json({
      success: true,
      data: updated.status === 'COMPLETED'
        ? { status: 'COMPLETED', report: reportFor(updated) }
        : stateFor(updated)
    });
  } catch (error) {
    if (error.statusCode === 409) return res.status(409).json({ success: false, error: error.message });
    return sendError(res, error);
  }
});

router.post('/:sessionId/skip', async (req, res) => {
  try {
    let session = await findOwnedSession(req.params.sessionId, req.user.id);
    if (!session) return res.status(404).json({ success: false, error: 'Interview session not found.' });
    if (session.status === 'COMPLETED') return res.status(409).json({ success: false, error: 'This interview is already complete.' });
    session = await expireIfNeeded(session);
    if (session.status === 'COMPLETED') return res.status(409).json({ success: false, error: 'Interview time has expired.' });
    if (!session.startedAt) return res.status(409).json({ success: false, error: 'Begin the interview before skipping a question.' });
    if (!currentQuestion(session) || req.body?.questionId !== currentQuestion(session).id) {
      return res.status(409).json({ success: false, error: 'The skip request must match the current question.' });
    }
    const updated = await advanceQuestion(session, 'SKIPPED');
    return res.json({
      success: true,
      data: updated.status === 'COMPLETED'
        ? { status: 'COMPLETED', report: reportFor(updated) }
        : stateFor(updated)
    });
  } catch (error) {
    if (error.statusCode === 409) return res.status(409).json({ success: false, error: error.message });
    return sendError(res, error);
  }
});

router.post('/:sessionId/end-session', async (req, res) => {
  try {
    const session = await findOwnedSession(req.params.sessionId, req.user.id);
    if (!session) return res.status(404).json({ success: false, error: 'Interview session not found.' });
    const reason = session.deadlineAt && new Date(session.deadlineAt).getTime() <= Date.now()
      ? 'TIME_UP'
      : 'USER_ENDED';
    const completed = await completeSession(session, reason);
    return res.json({ success: true, data: reportFor(completed) });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/:sessionId/report', async (req, res) => {
  try {
    let session = await findOwnedSession(req.params.sessionId, req.user.id);
    if (!session) return res.status(404).json({ success: false, error: 'Interview session not found.' });
    session = await expireIfNeeded(session);
    if (session.status !== 'COMPLETED') {
      return res.status(409).json({ success: false, error: 'The interview report is available after the session ends.' });
    }
    return res.json({ success: true, data: reportFor(session) });
  } catch (error) {
    return sendError(res, error);
  }
});

module.exports = router;
