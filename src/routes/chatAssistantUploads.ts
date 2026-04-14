import express from 'express';
import multer from 'multer';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { requireAuth } from '../middlewares/authMiddleware';
import { formatApiResponse } from '../utils/formatApiResponse';
import { validateUploadedFile } from '../middlewares/fileValidation';
import { authRepository } from '../repository/auth/authRepository';
import { uploadBufferToZata } from '../utils/storage/zataUpload';

const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const safeExt = ext && ext.length <= 12 ? ext : '';
      cb(null, `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${safeExt}`);
    },
  }),
  limits: {
    fileSize: 500 * 1024 * 1024,
  },
});

type AssistantAttachmentType = 'image' | 'video' | 'audio';
const GEMINI_MAX_IMAGE_BYTES = 7 * 1024 * 1024;
const UPLOAD_MAX_BYTES = 500 * 1024 * 1024;

function resolveExpectedMime(type: AssistantAttachmentType, mimeType: string): boolean {
  if (type === 'image') return mimeType.startsWith('image/');
  if (type === 'video') return mimeType.startsWith('video/');
  return mimeType.startsWith('audio/');
}

function validateAttachmentConstraints(type: AssistantAttachmentType, file: Express.Multer.File): string | null {
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return 'Uploaded file is empty or unreadable';
  }

  if (type === 'image' && file.size > GEMINI_MAX_IMAGE_BYTES) {
    return 'Image attachments must be 7MB or smaller';
  }

  if ((type === 'video' || type === 'audio') && file.size > UPLOAD_MAX_BYTES) {
    return 'This attachment exceeds the current 500MB upload limit';
  }

  return null;
}

function resolveUploadErrorMessage(error: any): string {
  const rawMessage = typeof error?.message === 'string' ? error.message : '';

  if (error?.name === 'TimeoutError' || /timeout/i.test(rawMessage)) {
    return 'Attachment upload timed out. Try again or use a smaller file.';
  }

  if (error?.name === 'UnknownError' || /streaming request/i.test(rawMessage)) {
    return 'Attachment storage upload failed. Try again or use a smaller file.';
  }

  return rawMessage || 'Failed to upload assistant attachment';
}

router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  let tmpPath: string | undefined;

  try {
    const uid = (req as any).uid;
    const type = String(req.body?.type || '') as AssistantAttachmentType;
    const threadId = typeof req.body?.threadId === 'string' ? req.body.threadId.trim() : '';
    const file = req.file;

    if (type !== 'image' && type !== 'video' && type !== 'audio') {
      return res.status(400).json(formatApiResponse('error', 'type must be image, video, or audio', null));
    }

    if (!file?.path) {
      return res.status(400).json(formatApiResponse('error', 'file is required', null));
    }

    tmpPath = file.path;

    if (!resolveExpectedMime(type, file.mimetype || '')) {
      return res.status(400).json(formatApiResponse('error', `Uploaded file mime type does not match declared type ${type}`, null));
    }

    const validation = await validateUploadedFile(file);
    if (!validation.valid) {
      return res.status(400).json(formatApiResponse('error', validation.reason || 'Invalid uploaded file', null));
    }

    const constraintsError = validateAttachmentConstraints(type, file);
    if (constraintsError) {
      return res.status(400).json(formatApiResponse('error', constraintsError, null));
    }

    const creator = await authRepository.getUserById(uid);
    const username = creator?.username || uid;

    const originalName = (file.originalname || file.filename || 'attachment').toString();
    const extFromName = path.extname(originalName).toLowerCase();
    const safeBase = (path.basename(originalName, extFromName).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'attachment');
    const keyPrefix = `users/${username}/assistant/${threadId || 'draft'}/${type}s`;
    const fileName = `${safeBase}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extFromName || ''}`;
    const key = `${keyPrefix}/${fileName}`;

    const fileBuffer = await fs.promises.readFile(file.path);
    const stored = await uploadBufferToZata(key, fileBuffer, file.mimetype || 'application/octet-stream');

    const attachment = {
      id: `assistant-att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      url: stored.publicUrl,
      fileName: originalName,
      mimeType: file.mimetype || null,
      storagePath: stored.key,
      sizeBytes: file.size || null,
    };

    return res.json(formatApiResponse('success', 'OK', { attachment }));
  } catch (error: any) {
    console.error('[AssistantUploadsRoute] Error:', {
      name: error?.name,
      message: error?.message,
      code: error?.code,
      stack: error?.stack,
    });
    return res.status(500).json(formatApiResponse('error', resolveUploadErrorMessage(error), null));
  } finally {
    if (tmpPath) {
      try { await fs.promises.unlink(tmpPath); } catch {}
    }
  }
});

export default router;
