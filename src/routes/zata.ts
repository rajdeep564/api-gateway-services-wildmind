import { Router } from 'express';
import { ZataController } from '../controllers/zataController';
import { uploadSingle, uploadMultiple } from '../middlewares/fileUpload';
import { ZATA_BUCKET, ZataService } from '../services/zataService';

const router = Router();

// Upload single file
router.post('/upload', uploadSingle('file'), ZataController.uploadFile);

// Upload multiple files
router.post('/upload-multiple', uploadMultiple('files', 5), ZataController.uploadFiles);

// Get signed download URL
router.get('/signed-url', ZataController.getSignedUrl);

// Get supported file types
router.get('/supported-types', ZataController.getSupportedTypes);

export default router;
 
// Helper endpoint to view a file by key via signed URL (handles nested keys)
router.get('/view/*', async (req, res) => {
  try {
    // Extract the wildcard path after /view/
    const pathAfterView = req.params[0] || '';

    // If the client accidentally passes full path with bucket prefix, strip it
    const key = pathAfterView.startsWith(`${ZATA_BUCKET}/`)
      ? pathAfterView.substring(`${ZATA_BUCKET}/`.length)
      : pathAfterView;

    if (!key) {
      return res.status(400).json({ responseStatus: 'error', message: 'Missing key' });
    }

    const signed = await ZataService.getSignedDownloadUrl(key, 3600);
    if (!signed.success || !signed.url) {
      return res.status(500).json({ responseStatus: 'error', message: signed.error || 'Failed to create signed URL' });
    }

    return res.redirect(signed.url);
  } catch (err: any) {
    return res.status(500).json({ responseStatus: 'error', message: err.message || 'Internal error' });
  }
});
