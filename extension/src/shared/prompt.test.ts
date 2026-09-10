import { describe, expect, it } from "vitest";
import {
  ANSWER_SYSTEM,
  buildAnswerPrompt,
  detectQuestionType,
  MAX_JOB_DESCRIPTION_CHARS,
} from "./prompt.js";

describe("detectQuestionType", () => {
  it("matches each keyword category (case-insensitive substring)", () => {
    expect(detectQuestionType("Tell me about yourself?")).toBe("introduction");
    expect(detectQuestionType("Please introduce yourself")).toBe("introduction");
    expect(detectQuestionType("Why do you want this job?")).toBe("motivation");
    expect(detectQuestionType("Why this company appeals to you")).toBe("motivation");
    expect(detectQuestionType("Describe a time you handled conflict")).toBe("behavioral");
    expect(detectQuestionType("Tell me about a time you led a team")).toBe("behavioral");
    expect(detectQuestionType("What is your experience with programming?")).toBe("technical");
    expect(detectQuestionType("What is your expected salary?")).toBe("salary");
    expect(detectQuestionType("What is your biggest weakness?")).toBe("strengths_weaknesses");
    expect(detectQuestionType("Write a cover letter for me")).toBe("cover_letter");
  });

  it("falls back to general when nothing matches", () => {
    expect(detectQuestionType("What is your favorite color?")).toBe("general");
    expect(detectQuestionType("")).toBe("general");
  });

  it("honors the keyword-map ordering when several categories match", () => {
    // "strength" (strengths_weaknesses) is checked before nothing else here,
    // but "salary" must win over a later category when the word appears.
    expect(detectQuestionType("Describe a time you discussed salary")).toBe("behavioral");
  });
});

describe("buildAnswerPrompt", () => {
  const profile = { first_name: "Ada", last_name: "Lovelace", skills: "Python" };

  it("builds the exact template for an introduction question with a hint", () => {
    const { prompt, questionType } = buildAnswerPrompt({
      question: "Tell me about yourself",
      profile,
      memories: [],
      jobDescription: "We are building a payments platform.",
      company: "Acme",
      role: "Engineer",
    });
    expect(questionType).toBe("introduction");
    expect(prompt).toBe(
      [
        "Question: Tell me about yourself",
        "Role: Engineer | Company: Acme",
        `Profile: ${JSON.stringify(profile, null, 2)}`,
        "Hint: 2-3 sentence professional intro: current role, one key achievement, why the role interests them.",
        "Past answers (style guide): No past answers available.",
        "Job description: We are building a payments platform.",
        "",
        "Answer:",
      ].join("\n"),
    );
  });

  it("omits the Hint line for general questions (empty hint)", () => {
    const { prompt, questionType } = buildAnswerPrompt({
      question: "What is your favorite color?",
      profile,
      memories: [],
      jobDescription: "",
      company: "",
      role: "",
    });
    expect(questionType).toBe("general");
    expect(prompt).toBe(
      [
        "Question: What is your favorite color?",
        "Role: the role | Company: the company",
        `Profile: ${JSON.stringify(profile, null, 2)}`,
        "Past answers (style guide): No past answers available.",
        "Job description: Not provided.",
        "",
        "Answer:",
      ].join("\n"),
    );
  });

  it("serializes memories with indent=2 when present", () => {
    const memories = [
      {
        id: "ans_1",
        score: 0.91,
        payload: { question: "Tell me about yourself", answer: "Hi, I'm Ada.", company: "Acme", role: "Engineer", questionType: "introduction" },
      },
    ];
    const { prompt } = buildAnswerPrompt({
      question: "Introduce yourself",
      profile,
      memories,
      jobDescription: "jd",
      company: "Acme",
      role: "Engineer",
    });
    expect(prompt).toContain(`Past answers (style guide): ${JSON.stringify(memories, null, 2)}`);
  });

  it("truncates the job description to 3000 chars after trimming", () => {
    const longJd = "x".repeat(3500);
    const { prompt } = buildAnswerPrompt({
      question: "Why do you want this job?",
      profile,
      memories: [],
      jobDescription: longJd,
      company: "Acme",
      role: "Engineer",
    });
    expect(prompt).toContain(`Job description: ${"x".repeat(MAX_JOB_DESCRIPTION_CHARS)}`);
    expect(prompt).not.toContain("x".repeat(MAX_JOB_DESCRIPTION_CHARS + 1));
  });
});

describe("ANSWER_SYSTEM", () => {
  it("starts with the Snag system preamble", () => {
    expect(ANSWER_SYSTEM.startsWith("You are Snag, an AI assistant")).toBe(true);
    expect(ANSWER_SYSTEM).toContain("Return ONLY the answer text");
  });
});
