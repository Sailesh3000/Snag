import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  findSimilar,
  type SimilarCandidate,
} from "./similarity.js";

describe("cosineSimilarity", () => {
  it("is 1 for parallel vectors (scale-invariant)", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 1], [2, 2])).toBeCloseTo(1);
  });

  it("is 0 for orthogonal vectors and -1 for opposite", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("returns 0 for empty input", () => {
    expect(cosineSimilarity([], [1, 2])).toBe(0);
  });
});

describe("findSimilar", () => {
  const A: SimilarCandidate = {
    id: "A",
    question: "qA",
    answer: "aA",
    company: "Acme",
    role: "Engineer",
    embedding: [0.75, 0.6614, 0], // score 0.75 vs [1,0,0]
  };
  const B: SimilarCandidate = {
    id: "B",
    question: "qB",
    answer: "aB",
    company: "Globex",
    role: "Analyst",
    embedding: [0.8, 0.6, 0], // score 0.80 vs [1,0,0]
  };
  const C: SimilarCandidate = {
    id: "C",
    question: "qC",
    answer: "aC",
    company: "",
    role: "",
    embedding: [0, 1, 0], // score 0 -> filtered by minScore
  };
  const NO_EMB: SimilarCandidate = { ...A, id: "NO_EMB", embedding: null };

  it("ranks by cosine score and filters below minScore", () => {
    const out = findSimilar([1, 0, 0], [A, B, C, NO_EMB], 3, 0.3);
    expect(out.map((m) => m.id)).toEqual(["B", "A"]);
    expect(out[0].score).toBeCloseTo(0.8);
    expect(out[1].score).toBeCloseTo(0.75);
  });

  it("lets a same-company/role boost flip a close ranking", () => {
    // Without context: B (0.80) beats A (0.75).
    expect(findSimilar([1, 0, 0], [A, B], 3, 0.3).map((m) => m.id)).toEqual(["B", "A"]);
    // With Acme/Engineer context: A gets +0.05 +0.03 = 0.83, beating B's 0.80.
    const boosted = findSimilar([1, 0, 0], [A, B], 3, 0.3, "Acme", "Engineer");
    expect(boosted.map((m) => m.id)).toEqual(["A", "B"]);
    // Raw (unboosted) score is preserved in the output.
    expect(boosted[0].score).toBeCloseTo(0.75);
  });

  it("respects topK", () => {
    const out = findSimilar([1, 0, 0], [A, B], 1, 0.3);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("B");
  });

  it("returns [] for an empty query embedding", () => {
    expect(findSimilar([], [A, B], 3, 0.3)).toEqual([]);
  });

  it("returns the expected payload shape", () => {
    const out = findSimilar([1, 0, 0], [A], 3, 0.3);
    expect(out[0].payload).toEqual({
      question: "qA",
      answer: "aA",
      company: "Acme",
      role: "Engineer",
      questionType: "",
    });
  });
});
