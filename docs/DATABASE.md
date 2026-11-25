# Database and migrations

ASCEND uses PostgreSQL through Prisma. The source of truth is `backend/prisma/schema.prisma`.

## Resume-domain models

| Model | Purpose and constraints |
|---|---|
| `User` | Account, bcrypt password hash, role (`CANDIDATE`, `ADMIN`, `RECRUITER`) and profile relations. |
| `CandidateResume` | Candidate-owned upload metadata, private storage key, SHA-256 dedupe key, review status, parsed JSON, analysis and improvement output. Unique `(userId, sha256)` and index `(userId, createdAt)`. |
| `ParsedResumeVersion` | Immutable snapshots of extracted/reviewed/corrected fields and evidence. Unique `(resumeId, version)`. |
| `AtsAnalysis` | Owner-scoped deterministic analysis, optionally linked to the source resume for legacy compatibility. |
| `JobDescription` | Owner-scoped source text and extracted structured requirements. Unique `(userId, contentHash)`. |
| `JobMatch` | Owner, resume/JD links, match score, criteria breakdown, matching and missing skills. |
| `ImprovementSuggestion` | Owner/resume-scoped proposed text, source evidence, reason, prompt version and pending/accepted/rejected state. |
| `GeneratedResume` | Owner, source resume, template, output content and private PDF/DOCX paths. |
| `CandidateReport` | Owner, resume, report type and generated filename. |
| `InterviewSession` | Authenticated owner, setup values, immutable JSON question plan, server start/deadline, current question position, completion reason and report score. |
| `QuestionAttempt` | Per-question answer or skip/unanswered state, score, matched/missing keywords, example answer and time taken. |

Resume-domain ownership is mandatory for active records. Relations cascade on user deletion; resume deletion cascades analyses, parsed versions and suggestions. Generated exports/reports use nullable resume links with `SetNull` in the schema, but the resume-delete endpoint first deletes the linked metadata and files.

The existing unrelated platform tables (tests, mock interviews, roadmaps, opportunities, activity) remain in the schema. This implementation does not make ownership mandatory on every legacy career-module model.

## Migrations

- `20261118103000_resume_intelligence`: resume/JD/match/export/report tables and password/tour fields.
- `20261118120000_secure_resume_ownership`: role and hash fields, parsed versions/suggestions, required owner relations and indexes. Before deleting ownerless rows from active tables, the migration copies them into `QuarantinedLegacyRecord`; it does not guess an owner. Review quarantine retention and restore policy before production rollout.
- `20261125140000_rework_mock_interviews`: additive interview session setup/plan/timer/completion columns and per-question example-answer, status and elapsed-time columns. It does not drop, rewrite or reset existing rows; legacy sessions retain a nullable planned-question count rather than receiving a fabricated total.

The two resume migrations are applied to the configured Supabase schema. The existing database already contained the earlier platform tables, so the eight legacy migrations were recorded as applied after read-only schema comparison. The two resume migrations then deployed successfully, Prisma reports the database up to date, and a read-only schema diff reports no differences. One ATS analysis with an orphaned user reference was preserved in `QuarantinedLegacyRecord`; no user was guessed.

The E2E test uses a temporary account and removes its account, resume, reports and generated files after the run. For another environment, validate and deploy migrations against a backed-up target:

```sh
cd backend
npx prisma generate
npx prisma migrate deploy
```

Do not use `prisma db push` as a production migration strategy. Use an isolated disposable PostgreSQL DB to validate the SQL, foreign keys, existing data conditions and rollback/restore procedure first.
