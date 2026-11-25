const { getTechnicalQuestions, getAllTechnicalQuestions, getHRQuestions } = require('./datasetLoader');

const QUESTION_COUNTS = Object.freeze({ 10: 5, 20: 8, 30: 12 });

function questionCountForDuration(durationMinutes) {
  const count = QUESTION_COUNTS[Number(durationMinutes)];
  if (!count) throw new Error('Duration must be 10, 20, or 30 minutes.');
  return count;
}

function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function normalizeQuestion(question, difficulty) {
  return {
    id: question.id,
    question: question.question,
    difficulty: question.difficulty || difficulty,
    expectedKeywords: question.expected_keywords || question.talking_points || [],
    weightage: question.weightage || {},
    exampleAnswer: question.example_answer || question.exampleAnswer || null,
    feedbackTemplates: question.feedback_templates || null,
    minLength: question.min_length || 0
  };
}

function buildQuestionPlan({ role, type, difficulty, experience, durationMinutes }, random = Math.random) {
  const count = questionCountForDuration(durationMinutes);
  const normalizedDifficulty = String(difficulty || 'medium').toLowerCase();
  const intro = {
    id: 'intro_q1',
    question: 'Tell me about yourself and the experience most relevant to this role.',
    difficulty: normalizedDifficulty,
    expectedKeywords: ['background', 'experience', 'skills', 'achievement', 'goal'],
    weightage: {},
    exampleAnswer: 'I am a [role] with experience in [relevant area]. In my recent work, I [specific achievement and impact]. My strongest skills are [skills], and I am interested in this role because [relevant goal].',
    feedbackTemplates: null,
    minLength: experience === '3+' ? 110 : experience === '1-3' ? 90 : 70
  };
  const roleQuestions = type === 'HR' ? getHRQuestions('General') : getTechnicalQuestions(role);
  const candidates = type === 'HR' ? roleQuestions : getAllTechnicalQuestions();
  const uniqueQuestions = [...new Map(candidates.map(question => [question.id, question])).values()];
  const roleQuestionIds = new Set(roleQuestions.map(question => question.id));
  const matchingDifficulty = uniqueQuestions.filter(question =>
    (question.difficulty || 'medium').toLowerCase() === normalizedDifficulty
  );
  const fallback = uniqueQuestions.filter(question =>
    (question.difficulty || 'medium').toLowerCase() !== normalizedDifficulty
  );
  const orderedCandidates = [
    ...shuffle(matchingDifficulty.filter(question => roleQuestionIds.has(question.id)), random),
    ...shuffle(matchingDifficulty.filter(question => !roleQuestionIds.has(question.id)), random),
    ...shuffle(fallback.filter(question => roleQuestionIds.has(question.id)), random),
    ...shuffle(fallback.filter(question => !roleQuestionIds.has(question.id)), random)
  ];
  const selected = orderedCandidates
    .slice(0, count - 1)
    .map(question => normalizeQuestion(question, normalizedDifficulty));

  if (selected.length < count - 1) {
    throw new Error(`Not enough unique questions to build a ${count}-question interview.`);
  }
  return [intro, ...selected];
}

module.exports = { QUESTION_COUNTS, questionCountForDuration, buildQuestionPlan };
