import axios from 'axios';
/// <reference types="jest" />

// NOTE: API base path is /api for mounted routes; health endpoints live at root (/health)
// We'll probe both /health and /api/feed. Adjust if a proxy remaps paths.

describe('Public Feed smoke tests', () => {
  // API runs on port 5000 by default. Allow override via API_BASE_URL (without trailing slash).
  const baseURL = (process.env.API_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
  const apiPrefix = '/api';
  const client = axios.create({ baseURL, timeout: 15000, validateStatus: () => true });

  it('root health endpoint responds OK', async () => {
    const res = await client.get('/health');
    expect(res.status).toBe(200);
    // formatApiResponse uses responseStatus/message
    expect(res.data?.responseStatus).toBe('success');
    expect(typeof res.data?.message).toBe('string');
  });

  it('feed returns items and optimized fields are counted', async () => {
    const res = await client.get(`${apiPrefix}/feed`, { params: { limit: 10, mode: 'image' } });
    expect(res.status).toBe(200);
    expect(res.data?.responseStatus).toBe('success');
    const items = (res.data?.data?.items || []) as any[];
    const meta = res.data?.data?.meta || {};

    let imagesTotal = 0;
    let imagesWithOptimized = 0;
    items.forEach((it) => {
      (it.images || []).forEach((im: any) => {
        imagesTotal += 1;
        if (im?.thumbnailUrl || im?.avifUrl) imagesWithOptimized += 1;
      });
    });

    // eslint-disable-next-line no-console
    console.log('[SMOKE] FEED', {
      itemCount: items.length,
      imagesTotal,
      imagesWithOptimized,
      hasMore: meta?.hasMore,
      nextCursor: meta?.nextCursor || null,
    });

    expect(Array.isArray(items)).toBe(true);
    expect(imagesTotal).toBeGreaterThanOrEqual(0);
    expect(imagesWithOptimized).toBeGreaterThanOrEqual(0);
  });

  it('first item detail returns and optimized fields presence is logged', async () => {
    const list = await client.get(`${apiPrefix}/feed`, { params: { limit: 1, mode: 'image' } });
    expect(list.status).toBe(200);
    expect(list.data?.responseStatus).toBe('success');
    const items = (list.data?.data?.items || []) as any[];
    if (items.length === 0) {
      // eslint-disable-next-line no-console
      console.log('[SMOKE] No items in feed to test detail endpoint.');
      return;
    }
    const id = items[0].id;
  const detail = await client.get(`${apiPrefix}/feed/${id}`);
  expect(detail.status).toBe(200);
  expect(detail.data?.responseStatus).toBe('success');
  const detailItem = detail.data?.data?.item;
  const images = ((detailItem?.images) || []) as any[];
    const hasOptimized = images.some((im) => im?.thumbnailUrl || im?.avifUrl);
    // eslint-disable-next-line no-console
    console.log('[SMOKE] DETAIL', { id, imagesCount: images.length, hasOptimized });
  });
});
