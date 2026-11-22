import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Errors } from '../errors';
import { loadEnv } from '../../config/env';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Detect image type from magic bytes (never trust the client MIME type or extension). */
export function detectImageType(buf: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'webp';
  }
  return null;
}

export function uploadDir(): string {
  return path.resolve(loadEnv().UPLOAD_DIR);
}

/** Validate and store an uploaded image. Returns the relative public path (/uploads/<file>). */
export async function saveImage(file: Express.Multer.File | undefined): Promise<string> {
  if (!file?.buffer) throw Errors.validation('No file uploaded (field name "file")');
  if (file.size > MAX_IMAGE_BYTES) throw Errors.validation('Image must be 2 MB or smaller');
  const ext = detectImageType(file.buffer);
  if (!ext) throw Errors.validation('Only JPEG, PNG or WebP images are allowed');
  const dir = uploadDir();
  await fs.mkdir(dir, { recursive: true });
  const name = `${randomUUID()}.${ext}`;
  await fs.writeFile(path.join(dir, name), file.buffer, { mode: 0o644 });
  return `/uploads/${name}`;
}

/** Turn a stored relative path into an absolute URL for clients. */
export function publicUrl(relative: string | null | undefined): string | null {
  if (!relative) return null;
  if (/^https?:\/\//.test(relative)) return relative;
  return `${loadEnv().PUBLIC_API_URL.replace(/\/$/, '')}${relative}`;
}

export const imageUploadOptions = {
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
};
