import { Request, Response } from 'express';
import { ZataService } from '../services/zataService';
import { formatApiResponse } from '../utils/formatApiResponse';
import { logger } from '../utils/logger';

export class ZataController {
  // Upload single file
  static async uploadFile(req: Request, res: Response): Promise<void> {
    try {
      const file = req.file;
      
      if (!file) {
        res.status(400).json(
          formatApiResponse('error', 'No file provided', null)
        );
        return;
      }

      // Get custom key from request body if provided
      const customKey = req.body.key;
      const contentType = file.mimetype;

      logger.info({
        filename: file.originalname,
        size: file.size,
        mimetype: file.mimetype,
        customKey
      }, 'Uploading file to Zata');

      const result = await ZataService.uploadFile(file.buffer, contentType, customKey);

      if (!result.success) {
        res.status(500).json(
          formatApiResponse('error', result.error || 'Upload failed', null)
        );
        return;
      }

      res.json(
        formatApiResponse('success', 'File uploaded successfully', {
          etag: result.etag,
          bucket: result.bucket,
          key: result.key,
          publicUrl: result.publicUrl,
          originalName: file.originalname,
          size: file.size,
          contentType: file.mimetype
        })
      );
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error uploading file');
      res.status(500).json(
        formatApiResponse('error', 'Internal server error', null)
      );
    }
  }

  // Upload multiple files
  static async uploadFiles(req: Request, res: Response): Promise<void> {
    try {
      const files = req.files as Express.Multer.File[];
      
      if (!files || files.length === 0) {
        res.status(400).json(
          formatApiResponse('error', 'No files provided', null)
        );
        return;
      }

      logger.info({
        fileCount: files.length,
        files: files.map(f => ({ name: f.originalname, size: f.size, type: f.mimetype }))
      }, 'Uploading multiple files to Zata');

      const uploadPromises = files.map(async (file, index) => {
        const customKey = req.body.keys?.[index]; // Support custom keys array
        return ZataService.uploadFile(file.buffer, file.mimetype, customKey);
      });

      const results = await Promise.all(uploadPromises);
      
      const successfulUploads = results.filter(r => r.success);
      const failedUploads = results.filter(r => !r.success);

      if (failedUploads.length > 0) {
        logger.warn({
          successful: successfulUploads.length,
          failed: failedUploads.length,
          errors: failedUploads.map(f => f.error)
        }, 'Some file uploads failed');
      }

      const responseData = {
        total: files.length,
        successful: successfulUploads.length,
        failed: failedUploads.length,
        uploads: results.map((result, index) => ({
          originalName: files[index].originalname,
          size: files[index].size,
          contentType: files[index].mimetype,
          success: result.success,
          etag: result.etag,
          bucket: result.bucket,
          key: result.key,
          publicUrl: result.publicUrl,
          error: result.error
        }))
      };

      const status = failedUploads.length === 0 ? 'success' : 'error';
      const message = failedUploads.length === 0 ? 'All files uploaded successfully' :
                     successfulUploads.length === 0 ? 'All file uploads failed' :
                     'Some files uploaded successfully, some failed';

      res.json(
        formatApiResponse(status, message, responseData)
      );
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error uploading files');
      res.status(500).json(
        formatApiResponse('error', 'Internal server error', null)
      );
    }
  }

  // Get signed download URL
  static async getSignedUrl(req: Request, res: Response): Promise<void> {
    try {
      const { key } = req.query;
      const expiresIn = parseInt(req.query.expiresIn as string) || 600; // Default 10 minutes

      if (!key || typeof key !== 'string') {
        res.status(400).json(
          formatApiResponse('error', 'File key is required', null)
        );
        return;
      }

      logger.info({ key, expiresIn }, 'Generating signed URL for file');

      const result = await ZataService.getSignedDownloadUrl(key, expiresIn);

      if (!result.success) {
        res.status(500).json(
          formatApiResponse('error', result.error || 'Failed to generate signed URL', null)
        );
        return;
      }

      res.json(
        formatApiResponse('success', 'Signed URL generated', {
          url: result.url,
          key,
          expiresIn
        })
      );
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error generating signed URL');
      res.status(500).json(
        formatApiResponse('error', 'Internal server error', null)
      );
    }
  }

  // Get supported file types
  static getSupportedTypes(req: Request, res: Response): void {
    const supportedTypes = ZataService.getSupportedMimeTypes();
    
    res.json(
      formatApiResponse('success', 'Supported file types retrieved', {
        mimeTypes: supportedTypes,
        categories: {
          images: supportedTypes.filter(type => type.startsWith('image/')),
          videos: supportedTypes.filter(type => type.startsWith('video/')),
          audio: supportedTypes.filter(type => type.startsWith('audio/'))
        }
      })
    );
  }
}
