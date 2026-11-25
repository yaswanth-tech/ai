# ASCEND User Manual

Welcome to ASCEND — your comprehensive Career Intelligence and Resume Optimization platform. This manual walks you through the features and workflows available.

---

## 1. Getting Started: Account Creation & Sign In

1. Open `http://localhost:3002/index.html` in your browser.
2. Click the **Sign Up** tab:
   - Enter your Full Name, Email, and a password (minimum 8 characters).
   - Click **Create Account**. Your credentials are securely hashed and a JWT session is issued.
3. Or sign in using your registered email and password.

---

## 2. Analyzing Your Resume

1. From the navigation sidebar, click **Resume Analysis** (or open `resume_upload.html`).
2. Select your **Target Job Role** from the dropdown menu (e.g. *Backend Developer*, *Frontend Developer*, *Full Stack Developer*, *Data Analyst*, *AI / ML Engineer*).
3. Click **Choose File** and select your resume in **PDF** or **Word (DOCX)** format (up to 5MB).
4. Click **Upload & Analyze Resume**.
5. Once processed, the **Resume Intelligence Workbench** will automatically open.

Uploads are limited to 5 MiB. AI-provider analysis is optional and disabled by default in the sample environment; deterministic rule-based analysis remains available. Scanned PDFs need OCR language data configured by the server operator.

---

## 3. Reviewing & Editing Extracted Candidate Data

1. Click on the **✏️ Edit Candidate Record** tab.
2. The system pre-fills all 11 extracted fields:
   - Full Name, Email, Phone
   - Professional Summary
   - Technical Skills & Developer Tools
   - Education & Degrees
   - Experience & Projects
   - Certifications & Key Achievements
3. Make any necessary corrections or add new projects directly in the text areas.
4. Click **💾 Save & Re-evaluate ATS** to immediately recalculate your score and refresh analysis.

---

## 4. Exploring AI Insights & "Why" Rationales

1. Click on the **🧠 AI Insights & 'Why'** tab.
2. Review categorized evaluation cards:
   - **Strengths**: Proven competencies grounded in your resume text.
   - **Weaknesses / Development Areas**: Missing impact metrics, sparse summaries, etc.
   - **Missing Information**: Key contact, certifications, or tool sections.
   - **Suggestions**: Actionable steps to optimize keyword relevance.
3. Each card explains the recruiter reasoning behind the observation.

---

## 5. Matching against a Job Description (JD)

1. Use the **Job Description Analysis** card on the resume page to analyze and save a JD at any time. After uploading a resume, open the **🎯 Job Description Match** tab to compare the JD with that resume.
2. Paste the job description text into the text area **OR** upload a job requisition file (`.pdf`, `.docx`, `.txt`).
3. Click **🎯 Match Against Resume**.
4. The system outputs:
   - **Alignment Score** (0-100%)
   - **Score Breakdown** (Skills score, Experience score, Education score)
   - **Matched Skills** (Green tags)
   - **Missing Skills / Skill Gaps** (Red tags)
   - **Extracted JD Details** (Required experience, qualifications, and key duties)

The score weights are Skills 50%, Experience 25% (stated years and skill relevance in experience/projects), Education 15%, and section structure 10%. Review the evidence and missing-skill explanations. The score is guidance, not a prediction of hiring success.

---

## 6. Reviewing Side-by-Side Rewrites (Accept / Reject)

1. Click on the **🔄 Side-by-Side Rewrites** tab.
2. **Professional Summary Rewrite**: Compare your current summary side-by-side with the improved executive version. Click **Accept** to apply it directly to your profile, or **Reject** to keep your original.
3. **STAR Bullet Rewrites**: View enhanced project and work experience bullets side-by-side with reasons. Click **Accept** on any bullet to integrate it into your profile and re-score your resume.

---

## 7. Generating Resumes across 3 Templates

1. Click on the **📄 Generate Resumes (3 Templates)** tab.
2. Select one of the three professionally designed layouts:
   - **Modern Clean**: Indigo headers, clean two-tier layout, modern sans-serif typography.
   - **Executive Classic**: Centered header, formal serif font, and classic divider lines.
   - **Tech Minimal**: Monospace font accents, developer-first layout, high skill density.
3. Click **📥 Export to PDF** or **📝 Export to Word (DOCX)**.
4. Click the download link to save your formatted resume file.

Review suggested text before accepting. Rewrites are checked against extracted source data; verify every statement yourself and do not add qualifications you do not hold.

---

## 8. Exporting Analytics Reports

1. Click on the **📥 Download Reports** tab.
2. Choose your desired report:
   - **Full Analysis PDF Report**: Multi-page report containing your ATS score, detected issues, step-by-step corrections, and AI strengths/gaps.
   - **Skill-Match CSV Report**: Spreadsheet-ready CSV with matched skills, target gaps, and role benchmarks.

---

## 9. Practicing with a Mock Interview

1. Open **Mock Interview** from the dashboard and choose the interview type, target role (for technical practice), experience level, difficulty and 10-, 20- or 30-minute duration.
2. Review the live summary. The selected duration determines 5, 8 or 12 questions, including the introduction.
3. In the lobby, optionally test your microphone and speakers, review the rules, then select **I’m ready — enter full screen**. The clock begins when the interview starts.
4. Answer by speaking or typing. Use **Re-record** once for a question, **Skip** to move on, or **End** to finish early. The timer continues if you leave full screen or refresh.
5. Review the report for the overall score, time used, answered/skipped/unanswered counts, strengths, focus areas and feedback/example answers for each question. Retake the interview, print the report or return to the dashboard.

Speech recognition depends on browser support and microphone permission. Typed answers remain available as a fallback.

---

## 10. Tracking Progress on the Dashboard

1. Click **Dashboard** in the sidebar (or open `dashboard.html`).
2. Review your holistic career preparation:
   - **Overall Readiness Score** and readiness status.
   - **Module Scores**: Resume, Technical Skills, Communication, Mock Interview, Roadmap.
   - **Resumes & ATS Evaluations**: View recent resumes and jump into review mode.
   - **Job Description Matches**: View past alignment percentages and gap counts.
   - **Generated Resumes Downloads**: Instant download buttons for PDF and Word files.
   - **Candidate Activities Feed**: Chronological log of recent uploads, tests, and roadmap tasks.
