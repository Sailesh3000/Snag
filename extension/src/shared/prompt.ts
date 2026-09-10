// Client-side port of the backend's answer-prompt assembly, so the extension
// can build the full prompt locally and ship only the final prompt to the
// server (plan B3: only /api/me, /api/answer/generate, /api/embed leave the
// browser).
//
// Sources (ported 1:1 — do not "improve" wording without porting back):
//   backend/answer_service.py   :: QUESTION_TYPE_KEYWORDS / detect_question_type
//                                 / build_prompt / MAX_JOB_DESCRIPTION_CHARS
//   backend/prompts/templates.py:: ANSWER_SYSTEM / TYPE_HINTS / _template
//
// Output must stay byte-compatible with the Python version: the prompt text
// is what the model conditions on, and drift between the two would make
// server-side and client-side behavior diverge.

export const ANSWER_SYSTEM = `You are Snag, an AI assistant helping a user fill out a job application.
Generate a professional, truthful, tailored answer for the question.

RULES:
- Use the user's actual profile data; never fabricate experience, skills, education,
  employment history, or certifications.
- Past answers are real examples the user previously approved — reuse the facts and
  style, but if a past answer was written for a different company or role than the
  current one, ADAPT it to the current company/role. Never paste a past answer
  unchanged when the company/role differs; only reuse verbatim when it was approved
  for this exact company and role.
- If a job description is provided, tailor the answer to the specific role/company.
- Keep the answer length appropriate to the question (a short factual question gets
  a short answer; an open-ended prompt can be a few sentences to a short paragraph).
- Return ONLY the answer text — no explanations, no meta-commentary, no quotation marks.`;

// Keyword-substring detection, in this exact order (Python dict insertion
// order; Object.entries preserves it for string keys).
export const QUESTION_TYPE_KEYWORDS: Record<string, string[]> = {
  introduction: ["tell me about yourself", "introduce yourself"],
  motivation: ["why do you want", "why are you interested", "why this role", "why this company"],
  behavioral: ["describe a time", "tell me about a time", "example of", "behavioral"],
  technical: ["technical", "programming", "coding", "technology stack"],
  salary: ["salary", "compensation", "expected pay"],
  strengths_weaknesses: ["strength", "weakness", "best quality"],
  cover_letter: ["cover letter", "why this position"],
};

export function detectQuestionType(question: string): string {
  const q = question.toLowerCase();
  for (const [qtype, keywords] of Object.entries(QUESTION_TYPE_KEYWORDS)) {
    if (keywords.some((kw) => q.includes(kw))) return qtype;
  }
  return "general";
}

export const MAX_JOB_DESCRIPTION_CHARS = 3000;

const TYPE_HINTS: Record<string, string> = {
  introduction: "2-3 sentence professional intro: current role, one key achievement, why the role interests them.",
  motivation: "Reference what draws the user to this company/role and connect their skills.",
  behavioral: "Use STAR format (Situation, Task, Action, Result).",
  technical: "Demonstrate competence and a clear problem-solving approach.",
  salary: "Give a flexible, professional salary expectation.",
  strengths_weaknesses: "Be honest and self-aware with a growth mindset.",
  cover_letter: "Write a cover letter, 3-4 short paragraphs.",
  general: "",
};

// Shape of a findSimilar() match (extension/src/similarity.ts) — same fields
// the Python find_similar returned and json.dumps'd into the prompt.
export interface MemoryEntry {
  id: string;
  score: number;
  payload: {
    question: string;
    answer: string;
    company: string;
    role: string;
    questionType: string;
  };
}

export interface BuildAnswerPromptArgs {
  question: string;
  profile: Record<string, string>;
  memories: MemoryEntry[];
  jobDescription?: string;
  company?: string;
  role?: string;
}

export function buildAnswerPrompt(args: BuildAnswerPromptArgs): { prompt: string; questionType: string } {
  const { question, profile, memories, company = "", role = "" } = args;
  const qtype = detectQuestionType(question);
  const hint = TYPE_HINTS[qtype] ?? "";
  const hintLine = hint ? `Hint: ${hint}\n` : "";

  const profileStr = JSON.stringify(profile, null, 2);
  const memoriesStr = memories.length > 0 ? JSON.stringify(memories, null, 2) : "No past answers available.";
  const jobDescription = (args.jobDescription || "").trim().slice(0, MAX_JOB_DESCRIPTION_CHARS);

  const prompt =
    `Question: ${question}\n` +
    `Role: ${role || "the role"} | Company: ${company || "the company"}\n` +
    `Profile: ${profileStr}\n` +
    hintLine +
    `Past answers (style guide): ${memoriesStr}\n` +
    `Job description: ${jobDescription || "Not provided."}\n\n` +
    `Answer:`;

  return { prompt, questionType: qtype };
}
