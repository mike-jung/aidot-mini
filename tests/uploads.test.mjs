import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { configureUploads, saveMultipart, validateImagePath } from '../src/core/uploads.js';

const fixtures = {
  "image/png": "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==",
  "image/jpeg": "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+ZP3E//Z",
  "image/webp": "UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoCAAIAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA="
};

async function upload(bytes, mime) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), 'image');
  const request = new Request('http://localhost/upload', { method: 'POST', body: form });
  return saveMultipart({ headers: { 'content-type': request.headers.get('content-type') }, body: Buffer.from(await request.arrayBuffer()) }, { profile: 'image' });
}

test('Image profile accepts PNG/JPEG/WebP and rejects a mismatched MIME without saving', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aidot-upload-regression-'));
  configureUploads({ publicDirectory: directory });
  try {
    for (const [mime, base64] of Object.entries(fixtures)) {
      const bytes = Buffer.from(base64, 'base64');
      const saved = await upload(bytes, mime);
      assert.equal(await validateImagePath(saved.url), saved.url);
      assert.deepEqual(await fs.readFile(path.join(directory, saved.url)), bytes);
      await assert.rejects(upload(bytes, mime === 'image/jpeg' ? 'image/png' : 'image/jpeg'), { status: 415 });
    }
    assert.equal((await fs.readdir(path.join(directory, 'uploads/images'))).length, 3);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
