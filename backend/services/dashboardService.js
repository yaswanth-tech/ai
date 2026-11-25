const prisma = require('../utils/prismaClient');
const path = require('path');

const WEIGHTS = {
  RESUME: 0.2,
  COMM: 0.2,
  INTERVIEW: 0.2,
  ROADMAP: 0.1
};

async function getDashboardStats(userId) {
  if (!userId || typeof userId !== 'string') throw new Error('Authenticated user ID is required.');
  // 1. Fetch dashboard data and saved resume artifacts
  const [
    user,
    candidateResume,
    legacyAts,
    technicalTest,
    commTest,
    interview,
    roadmap,
    savedOpps
  ] = await Promise.all([
    userId ? prisma.user.findUnique({ where: { id: userId } }) : null,
    userId ? prisma.candidateResume.findFirst({ where: { userId }, orderBy: { updatedAt: 'desc' } }) : prisma.candidateResume.findFirst({ orderBy: { updatedAt: 'desc' } }),
    userId ? prisma.atsAnalysis.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }) : prisma.atsAnalysis.findFirst({ orderBy: { createdAt: 'desc' } }),
    userId ? prisma.technicalTest.findFirst({ where: { userId, status: 'COMPLETED' }, orderBy: { createdAt: 'desc' } }) : null,
    userId ? prisma.communicationTest.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }) : null,
    userId ? prisma.interviewSession.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' }, include: { attempts: true } }) : null,
    userId ? prisma.userRoadmapProgress.findFirst({ where: { userId } }) : null,
    userId ? prisma.userOpportunity.count({ where: { userId, status: 'SAVED' } }) : 0
  ]);

  // 2. Calculate Resume Score
  const activeResume = candidateResume || legacyAts;
  const resumeScore = activeResume ? (activeResume.atsScore || 0) : 0;
  const resumeStatus = !activeResume ? 'Not Started' : (resumeScore > 70 ? 'Strong' : 'Needs Work');

  // 3. Calculate Technical Score
  const techScore = technicalTest
    ? Math.round((technicalTest.totalScore / (technicalTest.maxScore || 100)) * 100)
    : 0;
  const techStatus = !technicalTest ? 'Not Started' : (techScore > 70 ? 'Advanced' : 'Intermediate');

  // 4. Communication Score
  const commScore = commTest ? (commTest.totalScore || 0) : 0;
  const commStatus = !commTest ? 'Not Started' : (commScore > 70 ? 'Fluent' : 'Practice Needed');

  // 5. Mock Interview Score
  let interviewScore = 0;
  let interviewStatus = 'Not Started';
  if (interview) {
    const isCompleted = interview.status === 'COMPLETED';
    interviewStatus = isCompleted ? 'Completed' : 'In Progress';
    const plannedQuestionCount = interview.plannedQuestionCount ||
      (Array.isArray(interview.plannedQuestions) ? interview.plannedQuestions.length : 0) ||
      (interview.attempts && interview.attempts.length > 0 ? interview.attempts.length : 5);
    const totalPossible = plannedQuestionCount * 10;
    interviewScore = Math.min(100, Math.round(((interview.totalScore || 0) / totalPossible) * 100));
  }

  // 6. Roadmap Progress
  let roadmapScore = 0;
  let roadmapMeta = { phase: 1, progress: 0, nextAction: 'Select a Path' };

  if (roadmap) {
    const tasks = Array.isArray(roadmap.completedTasks) ? roadmap.completedTasks.length : 0;
    roadmapScore = Math.min((tasks / 20) * 100, 100);
    roadmapMeta = {
      phase: roadmap.currentPhase || 1,
      progress: Math.round(roadmapScore),
      nextAction: `Continue Phase ${roadmap.currentPhase || 1}`
    };
  }

  // 7. Overall Weighted Score
  const overallScore = Math.round(
    (
      (resumeScore * WEIGHTS.RESUME) +
      (commScore * WEIGHTS.COMM) +
      (interviewScore * WEIGHTS.INTERVIEW) +
      (roadmapScore * WEIGHTS.ROADMAP)
    ) / (WEIGHTS.RESUME + WEIGHTS.COMM + WEIGHTS.INTERVIEW + WEIGHTS.ROADMAP)
  );

  // 8. Verdict & Insight
  let verdict = "Not Ready";
  let color = "red";
  if (overallScore > 70) { verdict = "Industry Ready"; color = "green"; }
  else if (overallScore > 40) { verdict = "Getting There"; color = "orange"; }

  let insight = "Start your journey by uploading a resume.";
  if (!activeResume) insight = "Upload your resume to get an initial ATS score.";
  else if (!technicalTest) insight = "Take a technical test to prove your skills.";
  else if (!commTest) insight = "Test your communication skills to boost your score.";
  else if (overallScore < 50) insight = "Focus on your weakest module to level up.";

  const userName = user?.name || 'Student';

  return {
    user: { name: userName, role: "Student" },
    overall: {
      score: overallScore,
      verdict,
      color,
      insight
    },
    modules: {
      resume: { score: Math.round(resumeScore), status: resumeStatus, attempted: !!activeResume, role: activeResume?.targetRole || 'Not Selected' },
      technical: { score: techScore, status: techStatus, attempted: !!technicalTest },
      communication: { score: Math.round(commScore), status: commStatus, attempted: !!commTest },
      interview: { score: Math.round(interviewScore), status: interviewStatus, attempted: !!interview },
      roadmap: roadmapMeta,
      opportunities: { saved: savedOpps }
    },
  };
}

async function getDashboardArtifacts(userId) {
  if (!userId || typeof userId !== 'string') throw new Error('Authenticated user ID is required.');

  const [resumes, latestResume, matches, generatedResumes, reports, legacyAts] = await Promise.all([
    prisma.candidateResume.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { filename: true }
    }),
    prisma.candidateResume.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { atsScore: true }
    }),
    prisma.jobMatch.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        resumeId: true,
        targetRole: true,
        matchScore: true,
        jobDescription: { select: { title: true, targetRole: true } }
      }
    }),
    prisma.generatedResume.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        resumeId: true,
        templateName: true,
        pdfPath: true,
        docxPath: true,
        createdAt: true,
        resume: { select: { filename: true } }
      }
    }),
    prisma.candidateReport.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        resumeId: true,
        reportType: true,
        filename: true,
        createdAt: true,
        resume: { select: { filename: true } }
      }
    }),
    prisma.atsAnalysis.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { atsScore: true }
    })
  ]);

  const matchScoresByResume = new Map();
  for (const match of matches) {
    if (!matchScoresByResume.has(match.resumeId)) matchScoresByResume.set(match.resumeId, []);
    matchScoresByResume.get(match.resumeId).push(Math.round(match.matchScore));
  }

  return {
    resumes: resumes.map(resume => ({ filename: resume.filename })),
    resumeStrength: latestResume
      ? Math.round(latestResume.atsScore || 0)
      : (legacyAts ? Math.round(legacyAts.atsScore || 0) : null),
    matches: matches.map(match => ({
      id: match.id,
      resumeId: match.resumeId,
      role: match.targetRole === match.jobDescription?.title
        ? (match.jobDescription?.targetRole || match.targetRole)
        : match.targetRole,
      matchScore: match.matchScore
    })),
    generatedResumes: generatedResumes.map(resume => ({
      id: resume.id,
      resumeId: resume.resumeId,
      template: resume.templateName,
      filename: resume.pdfPath || resume.docxPath ? path.basename(resume.pdfPath || resume.docxPath) : null,
      sourceFilename: resume.resume?.filename || null,
      pdfUrl: resume.pdfPath ? `/api/resume/download/${encodeURIComponent(path.basename(resume.pdfPath))}` : null,
      docxUrl: resume.docxPath ? `/api/resume/download/${encodeURIComponent(path.basename(resume.docxPath))}` : null,
      matchScores: resume.resumeId ? (matchScoresByResume.get(resume.resumeId) || []) : [],
      date: resume.createdAt
    })),
    reports: reports.map(report => ({
      id: report.id,
      resumeId: report.resumeId,
      type: report.reportType,
      filename: report.filename,
      sourceFilename: report.resume?.filename || null,
      date: report.createdAt
    }))
  };
}

module.exports = { getDashboardStats, getDashboardArtifacts };
