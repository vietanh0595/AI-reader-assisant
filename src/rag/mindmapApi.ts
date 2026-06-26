import type { MindMapResponse } from './mindmapTypes';

type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

// generateMindMap: POST /library/books/{bookId}/mindmap/generate
// Returns the response body. Handles 409 gracefully (returns { status: "generating" }).
export async function generateMindMap(
  apiBaseUrl: string,
  bookId: string,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<MindMapResponse> {
  const url = `${apiBaseUrl}/library/books/${bookId}/mindmap/generate`;

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  if (response.status === 409) {
    return { status: 'generating' };
  }

  if (!response.ok) {
    throw new Error(`generateMindMap failed with status ${response.status}.`);
  }

  return response.json() as Promise<MindMapResponse>;
}

// getMindMap: GET /library/books/{bookId}/mindmap
// Returns { status: "pending" } on 404 (no record yet).
export async function getMindMap(
  apiBaseUrl: string,
  bookId: string,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<MindMapResponse> {
  const url = `${apiBaseUrl}/library/books/${bookId}/mindmap`;

  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 404) {
    return { status: 'pending' };
  }

  if (!response.ok) {
    throw new Error(`getMindMap failed with status ${response.status}.`);
  }

  return response.json() as Promise<MindMapResponse>;
}
