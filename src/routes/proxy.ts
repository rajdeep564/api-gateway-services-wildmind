import { Router } from 'express';
import { Request, Response } from 'express';
import fetch from 'node-fetch';
import { requireAuth } from '../middlewares/authMiddleware';

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

// Proxy endpoint for Zata resources to avoid CORS issues
router.get('/resource/:path(*)', requireAuth, async (req: Request, res: Response) => {
  try {
    const resourcePath = req.params.path;
    const zataUrl = `https://idr01.zata.ai/devstoragev1/${resourcePath}`;
    
    // Forward Range header for media streaming
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(zataUrl, {
      headers: {
        ...(req.headers.range ? { range: String(req.headers.range) } : {}),
      },
      // abort on timeout
      signal: controller.signal,
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

// Download endpoint for Zata resources with proper download headers
router.get('/download/:path(*)', requireAuth, async (req: Request, res: Response) => {
  try {
    const resourcePath = req.params.path;
    const zataUrl = `https://idr01.zata.ai/devstoragev1/${resourcePath}`;
    
    // Fetch the resource from Zata storage with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(zataUrl, { signal: controller.signal }).finally(() => clearTimeout(timeout));
    
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
router.get('/media/:path(*)', requireAuth, async (req: Request, res: Response) => {
  try {
    const resourcePath = req.params.path;
    const zataUrl = `https://idr01.zata.ai/devstoragev1/${resourcePath}`;
    
    // Fetch the resource with Range support and timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(zataUrl, {
      headers: {
        ...(req.headers.range ? { range: String(req.headers.range) } : {}),
      },
      signal: controller.signal,
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
