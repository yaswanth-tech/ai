const assert = require('assert');
const prisma = require('../utils/prismaClient');
const { getDashboardArtifacts, getDashboardStats } = require('../services/dashboardService');

async function runDashboardServiceTests() {
  const methods = [
    [prisma.user, 'findUnique'],
    [prisma.candidateResume, 'findMany'],
    [prisma.candidateResume, 'findFirst'],
    [prisma.atsAnalysis, 'findFirst'],
    [prisma.technicalTest, 'findFirst'],
    [prisma.communicationTest, 'findFirst'],
    [prisma.interviewSession, 'findFirst'],
    [prisma.userRoadmapProgress, 'findFirst'],
    [prisma.userOpportunity, 'count'],
    [prisma.jobMatch, 'findMany'],
    [prisma.generatedResume, 'findMany'],
    [prisma.candidateReport, 'findMany']
  ];
  const originalMethods = methods.map(([model, method]) => model[method]);
  const date = new Date('2026-01-02T03:04:05Z');
  let resumesQuery;
  let latestResumeQuery;
  let generatedQuery;
  let matchesQuery;
  let reportsQuery;

  try {
    prisma.candidateResume.findMany = async query => {
      resumesQuery = query;
      return Array.from({ length: 6 }, (_, index) => ({
        filename: `resume-${index}.pdf`
      })).slice(0, query.take);
    };
    prisma.candidateResume.findFirst = async query => {
      latestResumeQuery = query;
      return { atsScore: 71.4 };
    };
    prisma.atsAnalysis.findFirst = async () => ({ atsScore: 54 });
    prisma.jobMatch.findMany = async query => {
      matchesQuery = query;
      return [
        {
          id: 'match-1',
          resumeId: 'resume-1',
          targetRole: 'Cloud Platform Engineer',
          matchScore: 81.6,
          jobDescription: { title: 'Cloud Platform Engineer', targetRole: 'Software Engineer' }
        },
        {
          id: 'match-2',
          resumeId: 'resume-1',
          targetRole: 'AI Engineer',
          matchScore: 90.2,
          jobDescription: { title: 'Data Engineer', targetRole: 'Software Engineer' }
        }
      ].slice(0, query.take);
    };
    prisma.generatedResume.findMany = async query => {
      generatedQuery = query;
      return Array.from({ length: 6 }, (_, index) => ({
        id: `generated-${index}`,
        resumeId: 'resume-1',
        templateName: 'Modern Clean',
        pdfPath: '/files/generated.pdf',
        docxPath: null,
        createdAt: date,
        resume: { filename: 'resume-1.pdf' }
      })).slice(0, query.take);
    };
    prisma.candidateReport.findMany = async query => {
      reportsQuery = query;
      return Array.from({ length: 6 }, (_, index) => ({
        id: `report-${index}`,
        resumeId: 'resume-1',
        reportType: index % 2 ? 'csv' : 'pdf',
        filename: `report-${index}.${index % 2 ? 'csv' : 'pdf'}`,
        createdAt: date,
        resume: { filename: 'resume-1.pdf' }
      })).slice(0, query.take);
    };

    const data = await getDashboardArtifacts('user-1');

    assert.strictEqual(resumesQuery.take, 5);
    assert.deepStrictEqual(resumesQuery.select, { filename: true });
    assert.deepStrictEqual(latestResumeQuery.orderBy, { updatedAt: 'desc' });
    assert.strictEqual(matchesQuery.take, 5);
    assert.strictEqual(generatedQuery.take, 5);
    assert.strictEqual(reportsQuery.take, 5);
    assert.strictEqual(data.resumes.length, 5);
    assert.deepStrictEqual(data.resumes[0], { filename: 'resume-0.pdf' });
    assert.strictEqual(data.resumeStrength, 71);
    assert.deepStrictEqual(data.matches.map(match => match.matchScore), [81.6, 90.2]);
    assert.deepStrictEqual(data.matches.map(match => match.role), ['Software Engineer', 'AI Engineer']);
    assert.deepStrictEqual(data.generatedResumes[0].matchScores, [82, 90]);
    assert.strictEqual(data.generatedResumes.length, 5);
    assert.strictEqual(data.generatedResumes[0].pdfUrl, '/api/resume/download/generated.pdf');
    assert.strictEqual(data.reports.length, 5);
    assert.strictEqual(data.reports[0].filename, 'report-0.pdf');
    prisma.candidateResume.findMany = async () => [];
    prisma.candidateResume.findFirst = async () => null;
    const legacyData = await getDashboardArtifacts('user-1');
    assert.strictEqual(legacyData.resumeStrength, 54);

    let technicalTestQuery;
    prisma.user.findUnique = async () => ({ name: 'Test User' });
    prisma.candidateResume.findFirst = async () => null;
    prisma.atsAnalysis.findFirst = async () => null;
    prisma.technicalTest.findFirst = async query => {
      technicalTestQuery = query;
      return { totalScore: 75, maxScore: 100 };
    };
    prisma.communicationTest.findFirst = async () => null;
    prisma.interviewSession.findFirst = async () => null;
    prisma.userRoadmapProgress.findFirst = async () => null;
    prisma.userOpportunity.count = async () => 0;

    const stats = await getDashboardStats('user-1');
    assert.deepStrictEqual(technicalTestQuery, {
      where: { userId: 'user-1', status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' }
    });
    assert.deepStrictEqual(stats.modules.technical, {
      score: 75,
      status: 'Advanced',
      attempted: true
    });
    assert.strictEqual(stats.overall.score, 0);

    prisma.interviewSession.findFirst = async () => ({
      status: 'COMPLETED',
      totalScore: 20,
      plannedQuestionCount: 8,
      attempts: [{ score: 10 }, { score: 10 }]
    });
    const plannedInterviewStats = await getDashboardStats('user-1');
    assert.strictEqual(plannedInterviewStats.modules.interview.score, 25);
    assert.strictEqual(plannedInterviewStats.modules.interview.status, 'Completed');
    console.log('✔ Dashboard resume, score, generated file, and report data passed');
  } finally {
    methods.forEach(([model, method], index) => {
      model[method] = originalMethods[index];
    });
  }
}

module.exports = runDashboardServiceTests;
if (require.main === module) runDashboardServiceTests();
