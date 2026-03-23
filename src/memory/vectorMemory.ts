/**
 * Vector memory stub for semantic search over user creations.
 * Phase 9: replace with pgvector (or similar) implementation.
 * Until then, returns empty results so callers get a consistent API.
 */

export interface SimilarCreation {
  id: string;
  type: string;
  score: number;
  metadata?: Record<string, unknown>;
}

/**
 * Search for user creations similar to a text query (semantic/embedding search).
 * Stub: returns empty array until pgvector is implemented.
 */
export async function searchSimilarCreations(
  _userId: string,
  _query: string,
  limit: number = 10
): Promise<SimilarCreation[]> {
  // TODO: embed query, query vector store keyed by userId, return top-k
  return [];
}
