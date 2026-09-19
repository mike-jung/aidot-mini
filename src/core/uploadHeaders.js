import path from 'node:path';
import { isPublicImageFile } from './uploads.js';

export function uploadHeaders(publicDirectory) {
  const root = path.resolve(publicDirectory, 'uploads') + path.sep;
  return (res, file) => {
    if (!path.resolve(file).startsWith(root)) return;
    // Only server-generated raster image names are displayed inline.
    res.setHeader(
      'Content-Disposition',
      isPublicImageFile(publicDirectory, file) ? 'inline' : 'attachment',
    );
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
  };
}
