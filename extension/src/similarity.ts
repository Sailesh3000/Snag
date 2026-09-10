// Client-side semantic similarity search over the user's own stored answer
// embeddings. Pure computation — no network, no IndexedDB — so it's trivially
// testable. Embedding *vectors* are produced elsewhere (the backend /api/embed
// endpoint, subscription-gated) and stored locally alongside each answer.
//
// Ranking ported from backend/memory/memory_service.py::find_similar:
// cosine similarity with a small same-company / same-role boost so a
// previously-approved answer for the same company/role surfaces first, while a
// strong cross-company semantic match still wins.

export interface SimilarCandidate {
  id: string;
  question: string;
  answer: string;
  company: string;
  role: string;
  questionType?: string;
  embedding: number[] | null;
}

export interface SimilarMatch {
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

export const COMPANY_BOOST = 0.05;
export const ROLE_BOOST = 0.03;

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

export function findSimilar(
  queryEmbedding: number[],
  candidates: SimilarCandidate[],
  topK = 3,
  minScore = 0.3,
  company?: string,
  role?: string,
): SimilarMatch[] {
  if (!queryEmbedding || queryEmbedding.length === 0) return [];

  const results: (SimilarMatch & { rankScore: number })[] = [];
  for (const c of candidates) {
    if (!c.embedding || c.embedding.length === 0) continue;
    const score = cosineSimilarity(queryEmbedding, c.embedding);
    if (score < minScore) continue;

    let rankScore = score;
    if (company && c.company === company) rankScore += COMPANY_BOOST;
    if (role && c.role === role) rankScore += ROLE_BOOST;

    results.push({
      id: c.id,
      score,
      rankScore,
      payload: {
        question: c.question,
        answer: c.answer,
        company: c.company || "",
        role: c.role || "",
        questionType: c.questionType || "",
      },
    });
  }

  results.sort((x, y) => y.rankScore - x.rankScore);
  return results.slice(0, topK).map(({ id, score, payload }) => ({ id, score, payload }));
}
