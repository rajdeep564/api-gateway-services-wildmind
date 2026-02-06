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

// Allowed file signatures (Magic Bytes)
const FILE_SIGNATURES: Record<string, string[]> = {
  // Images
  'image/jpeg': ['ffd8ff'],
  'image/png': ['89504e47'],
  'image/webp': ['52494646'], // RIFF...WEBP (checked logic below)
  'image/gif': ['47494638'],
  // Videos
  'video/mp4': ['0000001866747970', '0000002066747970'], // ftyp box usually at start
  'video/quicktime': ['0000001466747970', '0000002066747970'], // mov
  'video/webm': ['1a45dfa3'],
};

export const validateFileContent = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.file) return next();

  const filePath = req.file.path;
  const mimeType = req.file.mimetype;

  try {
    // Read first 20 bytes
    const buffer = await readChunk(filePath, 24);
    const hex = buffer.toString('hex');

    let isValid = false;

    // Check specific magic bytes for mime type
    if (mimeType === 'image/jpeg') {
        isValid = hex.startsWith('ffd8ff');
    } else if (mimeType === 'image/png') {
        isValid = hex.startsWith('89504e47');
    } else if (mimeType === 'image/webp') {
        // RIFF....WEBP
        isValid = hex.startsWith('52494646') && hex.slice(16, 24) === '57454250';
    } else if (mimeType === 'image/gif') {
        isValid = hex.startsWith('47494638');
    } else if (mimeType === 'video/mp4' || mimeType === 'video/quicktime') {
         // Check for ftyp signature (it can vary in position slightly but usually first 4-8 bytes are size, then ftyp)
         // Common ftyp signatures: 00 00 00 18 66 74 79 70 (mp42)
         // We'll check if '66747970' (ftyp) exists in first 16 bytes
         isValid = hex.includes('66747970'); 
    } else if (mimeType === 'video/webm') {
        isValid = hex.startsWith('1a45dfa3');
    } else {
        // Unknown or unsupported type - strict mode: reject
        // Or if you want to allow others, set true (but riskier)
        // For this audit P0, we want STRICT.
        isValid = false;
        console.warn(`[FileValidation] Unsupported mime type uploaded: ${mimeType}`);
    }

    if (!isValid) {
      console.error(`[FileValidation] Invalid magic bytes for ${mimeType}. Hex: ${hex.slice(0, 32)}...`);
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
