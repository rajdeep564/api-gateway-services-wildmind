/**
 * File validation before permanent storage (SOC2 upload security).
 * 1. Magic-byte validation (file type matches extension).
 * 2. Optional antivirus scan — ClamAV when CLAMAV_ENABLED=true (CLAMAV_SOCKET or CLAMAV_SCAN_PATH).
 */

import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import { promisify } from 'util';
import { spawn } from 'child_process';
import path from 'path';

const CLAMAV_ENABLED = process.env.CLAMAV_ENABLED === 'true';
const CLAMAV_SOCKET = process.env.CLAMAV_SOCKET?.trim();
const CLAMAV_SCAN_PATH = process.env.CLAMAV_SCAN_PATH?.trim() || 'clamscan';

/**
 * Scan file with ClamAV. When CLAMAV_ENABLED is not set, returns { ok: true } (no-op).
 * Uses clamdscan with CLAMAV_SOCKET, or clamscan binary at CLAMAV_SCAN_PATH.
 * Return { ok: false } on virus or scan error (fail closed).
 */
export async function scanFileForMalware(filePath: string): Promise<{ ok: boolean }> {
  if (!CLAMAV_ENABLED) return { ok: true };

  const normalizedPath = path.resolve(filePath);
  return new Promise((resolve) => {
    const useClamd = Boolean(CLAMAV_SOCKET);
    const args = useClamd ? [normalizedPath] : ['--no-summary', '-i', normalizedPath];
    const bin = useClamd ? 'clamdscan' : CLAMAV_SCAN_PATH;
    const env = useClamd ? { ...process.env, CLAM_SOCKET: CLAMAV_SOCKET } : process.env;
    const proc = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    proc.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', (err) => {
      console.warn('[FileValidation] ClamAV spawn error:', (err as Error)?.message);
      resolve({ ok: false });
    });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true });
        return;
      }
      if (code === 1) {
        console.warn('[FileValidation] ClamAV: threat detected', normalizedPath, stderr.slice(0, 200));
      } else {
        console.warn('[FileValidation] ClamAV scan failed', { code, stderr: stderr.slice(0, 200) });
      }
      resolve({ ok: false });
    });
  });
}

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
      fs.unlinkSync(filePath);
      return res.status(400).json({
        success: false,
        message: 'Invalid file format. File content does not match extension.',
      });
    }

    // Antivirus: before permanent storage (SOC2). Implement scanFileForMalware for production (e.g. ClamAV).
    const av = await scanFileForMalware(filePath);
    if (!av.ok) {
      fs.unlinkSync(filePath);
      return res.status(400).json({
        success: false,
        message: 'File was rejected by security scan.',
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
