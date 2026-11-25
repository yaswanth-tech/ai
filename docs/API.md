# API reference

Base URL defaults to `http://localhost:3002/api`; set `PORT` and `CORS_ORIGINS` for deployment. Protected endpoints require `Authorization: Bearer <JWT>` for a candidate account. User IDs are derived from the token; clients must not send an owner ID to select records.

All request bodies are validated at route/service boundaries. Errors use `{ "success": false, "error": "..." }`; server errors do not return stack traces. Uploads are capped at 5 MiB.

## Authentication

| Method | Endpoint | Input / behavior |
|---|---|---|
| `POST` | `/auth/signup` | JSON `{name,email,password}`; password minimum 8 chars. Creates a candidate account and returns `{success,token,user}`. |
| `POST` | `/auth/login` | JSON `{email,password}` (legacy username field accepted); returns `{success,token,user}`. |
| `GET` | `/auth/me` | Authenticated current user. |

## Resume workflow

| Method | Endpoint | Input / behavior |
|---|---|---|
| `POST` | `/ats/analyze-resume` | Multipart fields `resume` (PDF/DOCX) and `targetRole`. Parses, scores, optionally analyzes, then returns `resumeId`, `candidateRecord`, `aiAnalysis`, `improvements`, `scoreBreakdown`, and guidance. |
| `POST` | `/ats/resumes` | Alias for resume analysis upload. |
| `POST` | `/ats/analyze-jd` | Multipart `jdText` or `jdFile` (PDF/DOCX/TXT), plus optional `targetRole`. Analyzes and saves structured JD requirements independently of a resume. |
| `GET` | `/ats/resumes` | Current user's resume list. |
| `GET` | `/ats/resume/:id` | Current user's resume details, analysis and scoring breakdown. |
| `GET` | `/ats/resumes/:id/file` | Download original file if owned by caller. |
| `DELETE` | `/ats/resumes/:id` | Deletes owned resume data and linked private generated/report files. |
| `POST` | `/ats/update-candidate` | JSON `{resumeId,targetRole?,candidateData}`. Candidate field correction is persisted and versioned. Fields: `name,email,phone,summary,education,experience,skills,certifications,projects,tools,achievements`. |
| `POST` | `/ats/match-jd` | Multipart text field `jdText` or file field `jdFile` (PDF/DOCX/TXT), plus `resumeId` and optional `targetRole`. Returns structured JD requirements, matching/missing skills, score breakdown, evidence and guidance notice. |
| `POST` | `/ats/apply-improvement` | JSON `{resumeId,type:"summary"|"bullet",itemIndex?,acceptedText,action:"accept"|"reject"}`. Acceptance must match the exact persisted suggestion. |
| `POST` | `/ats/generate-resume` | JSON `{resumeId,templateName,format:"pdf"|"docx"}`. Templates: `Modern Clean`, `Executive Classic`, `Tech Minimal`. Returns an authenticated `downloadUrl` and filename. |
| `POST` | `/ats/generate-report` | JSON `{resumeId,type:"pdf"|"csv",targetRole?}`. Returns authenticated download URL. |
| `GET` | `/ats/download/:filename` | Download only if the file metadata belongs to the current candidate. |

Resume upload requires extension and signature checks; DOCX additionally checks ZIP package structure. A duplicate content hash for the same owner returns the existing resume record rather than creating another.

The match score is deterministic, weighted guidance: required-skill overlap 50 points, experience 25 (10 for stated years and 15 for required skills found specifically in experience/projects), education requirement terms 15, and presence of skills/education/experience/projects sections 10. The response returns matched/missing skills, evidence quotes and the points for each criterion. It is not a hiring-success prediction.

## Mock interview

Every `/interview` route requires candidate authentication. A session is always scoped to `req.user`; the API ignores client-supplied owner IDs and returns 404 for sessions owned by someone else. The `/api/interview` prefix is available (the `/interview` alias is also mounted).

| Method | Endpoint | Input / behavior |
|---|---|---|
| `POST` | `/interview/start-session` | JSON `{role,type:"TECHNICAL"|"HR",experience:"fresher"|"1-3"|"3+",difficulty:"easy"|"medium"|"hard",duration:"10"|"20"|"30"}`. Creates a lobby session and stores its immutable question plan; the duration maps to 5, 8, or 12 total questions, including the introduction. |
| `POST` | `/interview/:sessionId/begin` | Starts the server-owned clock once and returns the first question, `startedAt`, and `deadlineAt`. Repeating this request resumes the original timer. |
| `GET` | `/interview/:sessionId/state` | Restores an owned session, current question and server time. Finalizes a session with `TIME_UP` if the deadline has passed. |
| `POST` | `/interview/:sessionId/submit-answer` | JSON `{questionId,answer}`. The ID must be the current planned question; completed sessions and wrong question IDs return 409. |
| `POST` | `/interview/:sessionId/skip` | JSON `{questionId}`. Records the matching current question as skipped and advances the plan. |
| `POST` | `/interview/:sessionId/end-session` | Ends an interview, marks remaining questions unanswered, and returns the report. Idempotent; dashboard activity is logged only once. If the deadline has passed the end reason is `TIME_UP`. |
| `GET` | `/interview/:sessionId/report` | Returns the completed report: score out of the full planned question total, elapsed time, answer counts, strengths, focus areas, and per-question feedback. |

The fixed question plan is selected at start, begins with an introduction, honors the selected role and difficulty where available, and never repeats a question. Example answers, keyword coverage and per-question elapsed time are persisted for the report. Session time is based on server timestamps, not the browser countdown.

## Dashboard/profile

- `GET /dashboard/stats` and `GET /dashboard/ats` require candidate authentication and return current-user dashboard data.
- `GET /user/current`, `GET /user/:id`, `POST /user/complete-tour` require candidate authentication; the profile route only permits the authenticated user's own ID.

Other practice, opportunity and roadmap endpoints remain mounted as in the existing project.
