/**
 * Cursor utilities for efficient pagination.
 * Encode createdAt timestamp + document ID to avoid fetching cursor document.
 */

export interface PaginationCursor {
  createdAt: string; // ISO timestamp
  id: string;
}

/**
 * Encode cursor to base64.
 */
export function encodeCursor(cursor: PaginationCursor): string {
  const json = JSON.stringify(cursor);
  return Buffer.from(json, 'utf-8').toString('base64');
}

/**
 * Decode cursor from base64.
 */
export function decodeCursor(encoded: string): PaginationCursor | null {
  try {
    const json = Buffer.from(encoded, 'base64').toString('utf-8');
    const cursor = JSON.parse(json) as PaginationCursor;
    if (!cursor.createdAt || !cursor.id) return null;
    return cursor;
  } catch {
    return null;
  }
}
