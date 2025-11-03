import { Router } from 'express';
import { Request, Response } from 'express';
import fetch from 'node-fetch';
import { Agent as HttpsAgent } from 'https';
import { ZATA_ENDPOINT, ZATA_BUCKET } from '../utils/storage/zataClient';
import sharp from 'sharp';
import { execFile } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

// Create HTTPS agent that ignores SSL certificate errors for Zata (certificate expired)
const httpsAgent = new HttpsAgent({
  rejectUnauthorized: false,
  keepAlive: true,
});

const router = Router();

// Helper function to get content type and file extension
const getContentInfo = (contentType: string, url: string) => {
  const extension = url.split('.').pop()?.toLowerCase() || '';
  
  // Map common extensions to content types
  const extensionMap: { [key: string]: string } = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'mp4': 'video/mp4',
    'webm': 'video/webm',
    'mov': 'video/quicktime',
    'avi': 'video/x-msvideo',
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'ogg': 'audio/ogg',
    'm4a': 'audio/mp4',
    'pdf': 'application/pdf',
    'txt': 'text/plain',
    'json': 'application/json'
  };

  const detectedType = extensionMap[extension] || contentType;
  
  return {
    contentType: detectedType,
    extension,
    isImage: detectedType.startsWith('image/'),
    isVideo: detectedType.startsWith('video/'),
    isAudio: detectedType.startsWith('audio/')
  };
};

function buildZataUrl(resourcePath: string): string {
  const endpoint = (ZATA_ENDPOINT || 'https://idr01.zata.ai').replace(/\/$/, '');
  const bucket = (ZATA_BUCKET || 'devstoragev1').replace(/^\//, '');
  // resourcePath is already URL-encoded by frontend routing, keep as-is
  return `${endpoint}/${bucket}/${resourcePath}`;
}

// Proxy endpoint for Zata resources to avoid CORS issues (no auth for public viewing)
router.get('/resource/:path(*)', async (req: Request, res: Response) => {
  try {
    const resourcePath = req.params.path;
    const zataUrl = buildZataUrl(resourcePath);
    
    // Forward Range header for media streaming
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(zataUrl, {
      headers: {
        ...(req.headers.range ? { range: String(req.headers.range) } : {}),
        ...(req.headers['if-none-match'] ? { 'if-none-match': String(req.headers['if-none-match']) } : {}),
        ...(req.headers['if-modified-since'] ? { 'if-modified-since': String(req.headers['if-modified-since']) } : {}),
      },
      // abort on timeout
      signal: controller.signal,
      agent: httpsAgent as any,
    }).finally(() => clearTimeout(timeout));
    // Allow 304 to pass through without treating as error
    if (!response.ok && response.status !== 304) {
      if (response.status === 404) return res.status(404).json({ error: 'Resource not found' });
      return res.status(response.status).json({ error: 'Upstream error' });
    }
    
    const contentType = response.headers.get('content-type') || '';
    const contentInfo = getContentInfo(contentType, zataUrl);
    
    // Set appropriate headers and forward key upstream headers
    res.status(response.status);
    const pass = ['content-type','content-length','accept-ranges','content-range','cache-control','etag','last-modified','access-control-allow-origin','access-control-allow-credentials'];
    pass.forEach((h) => {
      const v = response.headers.get(h);
      if (v) res.setHeader(h, v);
    });
    if (!response.headers.get('cache-control')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000');
    }
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    const origin = req.headers.origin as string | undefined;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    // If upstream returned 304, end without body
    if (response.status === 304) {
      return res.end();
    }
    // Stream the resource data
    response.body?.pipe(res);
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return res.status(504).json({ error: 'Upstream timeout' });
    }
    console.error('Proxy resource error:', error);
    res.status(500).json({ error: 'Failed to fetch resource' });
  }
});

// Download endpoint for Zata resources with proper download headers (no auth; files are already public)
router.get('/download/:path(*)', async (req: Request, res: Response) => {
  try {
    const resourcePath = req.params.path;
    const zataUrl = buildZataUrl(resourcePath);
    
    // Fetch the resource from Zata storage with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(zataUrl, { 
      headers: {
        ...(req.headers['if-none-match'] ? { 'if-none-match': String(req.headers['if-none-match']) } : {}),
        ...(req.headers['if-modified-since'] ? { 'if-modified-since': String(req.headers['if-modified-since']) } : {}),
      },
      signal: controller.signal,
      agent: httpsAgent as any,
    }).finally(() => clearTimeout(timeout));
    
    if (!response.ok && response.status !== 304) {
      if (response.status === 404) return res.status(404).json({ error: 'Resource not found' });
      return res.status(response.status).json({ error: 'Upstream error' });
    }
    
    const contentType = response.headers.get('content-type') || '';
    const contentInfo = getContentInfo(contentType, zataUrl);
    
    // Extract filename from path
    const filename = resourcePath.split('/').pop() || 'download';
    const finalFilename = contentInfo.extension ? filename : `${filename}.${contentInfo.extension}`;
    
    // Set download headers and forward key upstream headers
    res.status(response.status);
    res.setHeader('Content-Type', contentInfo.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${finalFilename}"`);
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    // allow browser to accept streamed download with cookies
    const origin = req.headers.origin as string | undefined;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    
    // Get content length if available
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }
    // If 304, end now
    if (response.status === 304) {
      return res.end();
    }
    // Stream the resource data
    response.body?.pipe(res);
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return res.status(504).json({ error: 'Upstream timeout' });
    }
    console.error('Download resource error:', error);
    res.status(500).json({ error: 'Failed to download resource' });
  }
});

// Generic media endpoint for all file types (images, videos, audio, documents)
router.get('/media/:path(*)', async (req: Request, res: Response) => {
  try {
    const resourcePath = req.params.path;
    const zataUrl = buildZataUrl(resourcePath);
    
    // Fetch the resource with Range support and timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(zataUrl, {
      headers: {
        ...(req.headers.range ? { range: String(req.headers.range) } : {}),
        ...(req.headers['if-none-match'] ? { 'if-none-match': String(req.headers['if-none-match']) } : {}),
        ...(req.headers['if-modified-since'] ? { 'if-modified-since': String(req.headers['if-modified-since']) } : {}),
      },
      signal: controller.signal,
      agent: httpsAgent as any,
    }).finally(() => clearTimeout(timeout));
    
    if (!response.ok && response.status !== 304) {
      if (response.status === 404) return res.status(404).json({ error: 'Resource not found' });
      return res.status(response.status).json({ error: 'Upstream error' });
    }
    
    const contentType = response.headers.get('content-type') || '';
    const contentInfo = getContentInfo(contentType, zataUrl);
    
    // Set appropriate headers for all media types, forward key headers
    res.status(response.status);
    const pass = ['content-type','content-length','accept-ranges','content-range','cache-control','etag','last-modified','access-control-allow-origin','access-control-allow-credentials'];
    pass.forEach((h) => {
      const v = response.headers.get(h);
      if (v) res.setHeader(h, v);
    });
    if (!response.headers.get('cache-control')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000');
    }
    // Avoid NotSameOriginResourcePolicy (CORP) blocking when embedding across origins
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    const origin = req.headers.origin as string | undefined;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    // 304? No body
    if (response.status === 304) {
      return res.end();
    }
    // Stream the resource data (works for images, videos, audio, etc.)
    response.body?.pipe(res);
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return res.status(504).json({ error: 'Upstream timeout' });
    }
    console.error('Proxy resource error:', error);
    res.status(500).json({ error: 'Failed to fetch resource' });
  }
});

export default router;

// Thumbnail endpoint for images stored in Zata (compressed webp previews)
router.get('/thumb/:path(*)', async (req: Request, res: Response) => {
  try {
    const resourcePath = req.params.path;
    const width = Math.max(16, Math.min(4096, parseInt(String(req.query.w || '512'), 10) || 512));
    const quality = Math.max(10, Math.min(95, parseInt(String(req.query.q || '60'), 10) || 60));
    const zataUrl = buildZataUrl(resourcePath);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(zataUrl, { 
      signal: controller.signal,
      agent: httpsAgent as any,
    }).finally(() => clearTimeout(timeout));
    if (!response.ok) {
      if (response.status === 404) return res.status(404).json({ error: 'Resource not found' });
      return res.status(response.status).json({ error: 'Upstream error' });
    }
    const contentType = response.headers.get('content-type') || '';

    // Conditional ETag based on upstream ETag/Last-Modified + params
    const upstreamEtag = response.headers.get('etag');
    const upstreamLM = response.headers.get('last-modified');
    const baseTag = upstreamEtag || (upstreamLM ? `W/"lm:${upstreamLM}"` : null);
    if (baseTag) {
      const baseCore = String(baseTag).replace(/\"/g, '').replace(/"/g, '');
      const mediaKind = contentType.startsWith('video/') ? 'vthumb' : 'thumb';
      const thumbTag = `W/"${mediaKind}:${baseCore}:${width}x${quality}"`;
      res.setHeader('ETag', thumbTag);
      const inm = req.headers['if-none-match'];
      if (inm && String(inm).replace(/\"/g, '').replace(/"/g, '') === thumbTag.replace(/\"/g, '').replace(/"/g, '')) {
        res.status(304);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        const origin = req.headers.origin as string | undefined;
        if (origin) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Vary', 'Origin');
          res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
        return res.end();
      }
    }
    // Handle images via sharp, videos via ffmpeg snapshot
    if (contentType.startsWith('image/')) {
      const source = Buffer.from(await response.arrayBuffer());
      const out = await sharp(source)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality })
        .toBuffer();
      res.status(200);
      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      const origin = req.headers.origin as string | undefined;
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      return res.send(out);
    }

    if (contentType.startsWith('video/')) {
      if (!ffmpegPath) {
        return res.status(501).json({ error: 'Video thumbnail not supported on this host' });
      }
      const buf = Buffer.from(await response.arrayBuffer());
      const tmpDir = os.tmpdir();
      const id = Math.random().toString(36).slice(2);
      const inPath = path.join(tmpDir, `wm_in_${id}`);
      const outPath = path.join(tmpDir, `wm_out_${id}.jpg`);
      try {
        await fs.writeFile(inPath, buf);
        // Grab a frame at 0.5s; scale by width preserving aspect
        await new Promise<void>((resolve, reject) => {
          execFile(String(ffmpegPath), ['-y', '-ss', '0.5', '-i', inPath, '-frames:v', '1', '-vf', `scale=${width}:-1:force_original_aspect_ratio=decrease`, outPath], (err) => {
            if (err) return reject(err);
            resolve();
          });
        });
        const frame = await fs.readFile(outPath);
        const webp = await sharp(frame).webp({ quality }).toBuffer();
        res.status(200);
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        const origin = req.headers.origin as string | undefined;
        if (origin) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Vary', 'Origin');
          res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
        return res.send(webp);
      } finally {
        // best-effort cleanup
        try { await fs.unlink(inPath); } catch {}
        try { await fs.unlink(outPath); } catch {}
      }
    }

    // Unsupported -> still return CORS headers for transparency
    const origin = req.headers.origin as string | undefined;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    return res.status(415).json({ error: 'Unsupported media type for thumbnail' });
  } catch (error: any) {
    if (error?.name === 'AbortError') return res.status(504).json({ error: 'Upstream timeout' });
    console.error('Thumb generation error:', error);
    const origin = req.headers.origin as string | undefined;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.status(500).json({ error: 'Failed to generate thumbnail' });
  }
});

// Lightweight external proxy for avatars or one-off assets (CORS-friendly, small cache)
router.get('/external', async (req: Request, res: Response) => {
  try {
    const url = String(req.query.url || '');
    if (!url) return res.status(400).json({ error: 'url is required' });
    // Basic allowlist for protocols
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Invalid URL' });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout));
    if (!resp.ok && resp.status !== 304) {
      return res.status(resp.status).json({ error: 'Upstream error' });
    }
    res.status(resp.status);
    const ct = resp.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('Content-Type', ct);
    const et = resp.headers.get('etag');
    if (et) res.setHeader('ETag', et);
    const lm = resp.headers.get('last-modified');
    if (lm) res.setHeader('Last-Modified', lm);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    const origin = req.headers.origin as string | undefined;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (resp.status === 304) return res.end();
    resp.body?.pipe(res);
  } catch (error: any) {
    if (error?.name === 'AbortError') return res.status(504).json({ error: 'Upstream timeout' });
    console.error('External proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch external resource' });
  }
});
