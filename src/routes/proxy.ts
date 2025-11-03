import { Router } from 'express';
import { Request, Response } from 'express';
import fetch from 'node-fetch';
import { Agent as HttpsAgent } from 'https';
import { ZATA_ENDPOINT, ZATA_BUCKET } from '../utils/storage/zataClient';
import sharp from 'sharp';

// Create HTTPS agent that ignores SSL certificate errors for Zata (certificate expired)
const httpsAgent = new HttpsAgent({
  rejectUnauthorized: false
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
      },
      // abort on timeout
      signal: controller.signal,
      agent: httpsAgent as any,
    }).finally(() => clearTimeout(timeout));
    
    if (!response.ok) {
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
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    const origin = req.headers.origin as string | undefined;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
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
      signal: controller.signal,
      agent: httpsAgent as any,
    }).finally(() => clearTimeout(timeout));
    
    if (!response.ok) {
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
    res.setHeader('Cache-Control', 'no-cache');
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
      },
      signal: controller.signal,
      agent: httpsAgent as any,
    }).finally(() => clearTimeout(timeout));
    
    if (!response.ok) {
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
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    const origin = req.headers.origin as string | undefined;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
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
    if (!contentType.startsWith('image/')) {
      return res.status(415).json({ error: 'Unsupported media type for thumbnail' });
    }
    const source = Buffer.from(await response.arrayBuffer());
    const out = await sharp(source)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();
    res.status(200);
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(out);
  } catch (error: any) {
    if (error?.name === 'AbortError') return res.status(504).json({ error: 'Upstream timeout' });
    console.error('Thumb generation error:', error);
    res.status(500).json({ error: 'Failed to generate thumbnail' });
  }
});
