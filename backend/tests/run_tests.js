const runAtsParserTests = require('./atsParser.test');
const runAtsEvaluatorTests = require('./atsEvaluator.test');
const runDashboardServiceTests = require('./dashboardService.test');
const runAIProviderTests = require('./aiProviderService.test');
const runResumeExportTests = require('./resumeExport.test');
const runAuthTests = require('./auth.test');
const runSecureUploadTests = require('./secureUpload.test');
const runUploadValidationTests = require('./uploadValidation.test');
const runJobMatchEvaluatorTests = require('./jobMatchEvaluator.test');
const runSafeRouteLoggingTests = require('./safeRouteLogging.test');
const runInterviewFlowTests = require('./interviewFlow.test');

async function main() {
  console.log('====================================================');
  console.log('🚀 ASCEND RESUME INTELLIGENCE PLATFORM TEST SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  const suites = [
    { name: 'ATS Parser Suite', fn: runAtsParserTests },
    { name: 'ATS Evaluator Suite', fn: runAtsEvaluatorTests },
    { name: 'Dashboard Service Suite', fn: runDashboardServiceTests },
    { name: 'AI Provider & Grounding Suite', fn: runAIProviderTests },
    { name: 'Authentication & Security Suite', fn: runAuthTests },
    { name: 'Secure Upload Validation Suite', fn: runSecureUploadTests },
    { name: 'Upload Boundary & Signature Validation Suite', fn: runUploadValidationTests },
    { name: 'Explainable JD Match Suite', fn: runJobMatchEvaluatorTests },
    { name: 'Safe Route Logging Suite', fn: runSafeRouteLoggingTests },
    { name: 'Mock Interview Flow Suite', fn: runInterviewFlowTests },
    { name: 'Resume Export (PDF & DOCX) Suite', fn: runResumeExportTests }
  ];

  for (const suite of suites) {
    try {
      await suite.fn();
      passed++;
      console.log(`\n✅ ${suite.name} PASSED\n`);
    } catch (err) {
      failed++;
      console.error(`\n❌ ${suite.name} FAILED:`, err.message);
      if (err.stack) console.error(err.stack);
    }
  }

  console.log('====================================================');
  console.log(`RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch(err => {
  console.error("Test runner encountered fatal error:", err);
  process.exit(1);
});
