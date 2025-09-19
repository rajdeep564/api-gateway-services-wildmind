import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from 'uuid';

export const ZATA_ENDPOINT = (process.env.ZATA_ENDPOINT || "https://idr01.zata.ai").replace(/\/$/, "");
export const ZATA_BUCKET = process.env.ZATA_BUCKET || "devdummy";

if (!process.env.ZATA_ACCESS_KEY_ID || !process.env.ZATA_SECRET_ACCESS_KEY) {
  console.warn("[Zata] Missing ZATA_ACCESS_KEY_ID or ZATA_SECRET_ACCESS_KEY env vars");
  console.warn("[Zata] Make sure these are set in your .env.local or .env file");
}

const s3Client = new S3Client({
  region: "us-east-1",
  endpoint: ZATA_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.ZATA_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.ZATA_SECRET_ACCESS_KEY || "",
  },
});

export interface UploadResult {
  success: boolean;
  etag?: string;
  bucket: string;
  key: string;
  publicUrl: string;
  error?: string;
}

export interface SignedUrlResult {
  success: boolean;
  url?: string;
  error?: string;
}

export class ZataService {
  static async uploadFile(
    buffer: Buffer,
    contentType: string,
    customKey?: string
  ): Promise<UploadResult> {
    try {
      if (!process.env.ZATA_ACCESS_KEY_ID || !process.env.ZATA_SECRET_ACCESS_KEY) {
        return {
          success: false,
          bucket: ZATA_BUCKET,
          key: "",
          publicUrl: "",
          error: "Zata credentials not configured"
        };
      }

      const key = customKey || `uploads/${uuidv4()}`;
      const bucket = process.env.ZATA_BUCKET || ZATA_BUCKET;

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
        Body: buffer,
      });

      const result = await s3Client.send(command);
      const publicUrl = `${ZATA_ENDPOINT}/${bucket}/${encodeURI(key)}`;

      return {
        success: true,
        etag: result.ETag,
        bucket,
        key,
        publicUrl,
      };
    } catch (error: any) {
      console.error("Zata upload error:", error);
      return {
        success: false,
        bucket: ZATA_BUCKET,
        key: "",
        publicUrl: "",
        error: error?.message || "Upload failed"
      };
    }
  }

  static async getSignedDownloadUrl(key: string, expiresIn: number = 600): Promise<SignedUrlResult> {
    try {
      const command = new GetObjectCommand({
        Bucket: ZATA_BUCKET,
        Key: key,
      });

      const url = await getSignedUrl(s3Client, command, { expiresIn });

      return {
        success: true,
        url,
      };
    } catch (error: any) {
      console.error("Zata signed URL error:", error);
      return {
        success: false,
        error: error?.message || "Failed to generate signed URL"
      };
    }
  }

  static getSupportedMimeTypes(): string[] {
    return [
      // Images
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
      // Videos
      'video/mp4',
      'video/avi',
      'video/mov',
      'video/wmv',
      'video/flv',
      'video/webm',
      'video/mkv',
      // Audio
      'audio/mp3',
      'audio/wav',
      'audio/ogg',
      'audio/aac',
      'audio/flac',
      'audio/m4a',
      'audio/wma'
    ];
  }

  static isValidFileType(mimeType: string): boolean {
    return this.getSupportedMimeTypes().includes(mimeType.toLowerCase());
  }

  static getFileExtension(mimeType: string): string {
    const mimeToExt: { [key: string]: string } = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/svg+xml': '.svg',
      'video/mp4': '.mp4',
      'video/avi': '.avi',
      'video/mov': '.mov',
      'video/wmv': '.wmv',
      'video/flv': '.flv',
      'video/webm': '.webm',
      'video/mkv': '.mkv',
      'audio/mp3': '.mp3',
      'audio/wav': '.wav',
      'audio/ogg': '.ogg',
      'audio/aac': '.aac',
      'audio/flac': '.flac',
      'audio/m4a': '.m4a',
      'audio/wma': '.wma'
    };
    
    return mimeToExt[mimeType.toLowerCase()] || '';
  }
}
