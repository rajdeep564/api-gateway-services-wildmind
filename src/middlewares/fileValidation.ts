import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import { promisify } from 'util';

const readChunk = async (filePath: string, length: number): Promise<Buffer> => {
  const handle = await promisify(fs.open)(filePath, 'r');
  const buffer = Buffer.alloc(length);
  await promisify(fs.read)(handle, buffer, 0, length, 0);
  await promisify(fs.close)(handle);
  return buffer;
};

type UploadedFileLike = {
  path?: string;
  mimetype?: string;
};

function validateBufferAgainstMime(buffer: Buffer, mimeType: string): boolean {
  const hex = buffer.toString('hex');

  if (mimeType === 'image/jpeg') {
    return hex.startsWith('ffd8ff');
  }

  if (mimeType === 'image/png') {
    return hex.startsWith('89504e47');
  }

  if (mimeType === 'image/webp') {
    return hex.startsWith('52494646') && hex.slice(16, 24) === '57454250';
  }

  if (mimeType === 'image/gif') {
    return hex.startsWith('47494638');
  }

  if (mimeType === 'video/mp4' || mimeType === 'video/quicktime' || mimeType === 'audio/mp4' || mimeType === 'audio/x-m4a') {
    return hex.includes('66747970');
  }

  if (mimeType === 'video/webm' || mimeType === 'audio/webm') {
    return hex.startsWith('1a45dfa3');
  }

  if (mimeType === 'audio/mpeg' || mimeType === 'audio/mp3') {
    return hex.startsWith('494433') || hex.startsWith('fffb') || hex.startsWith('fff3') || hex.startsWith('fff2');
  }

  if (mimeType === 'audio/wav' || mimeType === 'audio/x-wav') {
    return hex.startsWith('52494646') && hex.slice(16, 24) === '57415645';
  }

  if (mimeType === 'audio/ogg') {
    return hex.startsWith('4f676753');
  }

  return false;
}

export async function validateUploadedFile(file?: UploadedFileLike): Promise<{ valid: boolean; mimeType?: string; reason?: string }> {
  if (!file?.path || !file?.mimetype) {
    return { valid: false, reason: 'Missing file path or mime type' };
  }

  const buffer = await readChunk(file.path, 24);
  const mimeType = file.mimetype;
  const isValid = validateBufferAgainstMime(buffer, mimeType);

  if (!isValid) {
    return {
      valid: false,
      mimeType,
      reason: `Invalid magic bytes for ${mimeType}.`,
    };
  }

  return { valid: true, mimeType };
}

export const validateFileContent = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.file) return next();

  const filePath = req.file.path;
  const mimeType = req.file.mimetype;

  try {
    const result = await validateUploadedFile(req.file);

    if (!result.valid) {
      const buffer = await readChunk(filePath, 24);
      const hex = buffer.toString('hex');
      console.error(`[FileValidation] ${result.reason || `Invalid magic bytes for ${mimeType}`} Hex: ${hex.slice(0, 32)}...`);
      // Delete malicious file immediately
      fs.unlinkSync(filePath);
      return res.status(400).json({
        success: false,
        message: 'Invalid file format. File content does not match extension.',
      });
    }

    next();
  } catch (error) {
    console.error('[FileValidation] Error validating file:', error);
    // Fail closed
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return res.status(500).json({ success: false, message: 'File validation failed' });
  }
};
