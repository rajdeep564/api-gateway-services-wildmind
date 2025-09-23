import { Router } from 'express';
import bflRoutes from './bfl';
import zataRoutes from './zata';
import falRoutes from './fal';
import { ZataController } from '../controllers/zataController';
import { uploadSingle } from '../middlewares/fileUpload';
import { ZataService } from '../services/zataService';
import { logger } from '../utils/logger';

const router = Router();

router.use('/bfl', bflRoutes);
router.use('/zata', zataRoutes);
router.use('/fal', falRoutes);

// Legacy endpoint that your frontend is expecting
router.post('/upload-media', uploadSingle('media'), async (req: any, res: any, next: any) => {
  try {
    const file = req.file;
    const fileName = req.body.fileName;
    const mediaType = req.body.mediaType;
    
    logger.info({
      fileName,
      mediaType,
      size: file?.size,
      mimetype: file?.mimetype
    }, 'Media upload request received');
    
    if (!file) {
      return res.status(400).json({
        responseStatus: 'error',
        message: 'No media file provided'
      });
    }
    
    // Use existing Zata service to upload
    const result = await ZataService.uploadFile(file.buffer, file.mimetype, fileName);
    
    if (!result.success) {
      return res.status(500).json({
        responseStatus: 'error',
        message: result.error || 'Upload failed'
      });
    }
    
    // Try to create a time-limited signed URL so the client can view the file even if the bucket is private
    let signedUrl: string | undefined;
    try {
      const signed = await ZataService.getSignedDownloadUrl(result.key, 3600);
      if (signed.success && signed.url) {
        signedUrl = signed.url;
      }
    } catch (e) {
      // Best-effort; fall back to public URL if signing fails
    }

    logger.info({ zataUrl: result.publicUrl, signedUrl }, 'Media uploaded to Zata AI successfully');

    res.json({
      responseStatus: 'success',
      // Prefer signed URL if available; fall back to constructed public URL
      url: signedUrl || result.publicUrl,
      mediaType: mediaType,
      fileName: fileName,
      zataKey: result.key,
      bucket: result.bucket,
      publicUrl: result.publicUrl,
      signedUrl
    });
    
  } catch (error: any) {
    logger.error({ error: error.message }, 'Media upload failed');
    res.status(500).json({
      responseStatus: 'error',
      message: error.message
    });
  }
});

export default router;
