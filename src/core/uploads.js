import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_BODY_BYTES = 6 * 1024 * 1024;
const IMAGE_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp)$/;
let uploadRoot = path.resolve(process.env.PUBLIC_DIR || 'public', 'uploads');
const fail = (status, message) => Object.assign(new Error(message), { status });

// Configure this once at startup, using the same root as express.static/router.static_.
export function configureUploads({ publicDirectory }) {
  uploadRoot = path.resolve(publicDirectory, 'uploads');
}

function generalLimit() {
  const limit = Number(process.env.UPLOAD_MAX_BYTES || 20 * 1024 * 1024);
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error('Invalid UPLOAD_MAX_BYTES');
  return limit;
}

export function readRawBody(req, limit = IMAGE_BODY_BYTES, timeoutMs = 30000) {
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > limit) throw fail(413, '업로드 요청이 너무 큽니다.');
    return Promise.resolve(req.body);
  }
  if (req.readableEnded || req.destroyed)
    throw fail(400, '업로드 본문을 읽을 수 없습니다.');
  return new Promise((resolve, reject) => {
    let done = false;
    let size = 0;
    const chunks = [];
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('aborted', onAborted);
      if (error) {
        chunks.length = 0;
        req.resume();
        reject(error);
      } else resolve(value);
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > limit) return finish(fail(413, '업로드 요청이 너무 큽니다.'));
      chunks.push(chunk);
    };
    const onEnd = () => finish(null, Buffer.concat(chunks));
    const onError = () => finish(fail(400, '업로드 연결이 끊어졌습니다.'));
    const onAborted = () => finish(fail(400, '업로드가 중단되었습니다.'));
    const timer = setTimeout(
      () => finish(fail(408, '업로드 시간이 초과되었습니다.')),
      timeoutMs,
    );
    timer.unref?.();
    req.on('data', onData);
    req.once('end', onEnd);
    req.once('error', onError);
    req.once('aborted', onAborted);
    if (Number(req.headers['content-length']) > limit)
      finish(fail(413, '업로드 요청이 너무 큽니다.'));
  });
}

function safeName(value) {
  const name = path
    .basename(String(value || '').replaceAll('\\', '/'))
    .replace(/[^\w.\-가-힣 ]/g, '_');
  if (!name || name.startsWith('.') || Buffer.byteLength(name) > 220) {
    throw fail(400, '사용할 수 없는 파일 이름입니다.');
  }
  return name;
}

function imageFormat(bytes, mime) {
  let format;
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
    bytes.toString('ascii', 12, 16) === 'IHDR'
  ) {
    format = { extension: 'png', mime: 'image/png' };
  } else if (
    bytes.length >= 4 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  ) {
    format = { extension: 'jpg', mime: 'image/jpeg' };
  } else if (
    bytes.length >= 16 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    format = { extension: 'webp', mime: 'image/webp' };
  }
  if (!format || mime !== format.mime)
    throw fail(415, 'PNG, JPEG, WebP 파일 형식과 MIME이 일치해야 합니다.');
  return format;
}

// Exclusive creation prevents concurrent requests from overwriting another upload.
async function saveFile(name, bytes, image = false) {
  const directory = image ? path.join(uploadRoot, 'images') : uploadRoot;
  await fs.mkdir(directory, { recursive: true });
  const extension = path.extname(name);
  const stem = name.slice(0, name.length - extension.length);
  for (let index = 1; index <= 10000; index++) {
    const saved = index === 1 ? name : `${stem}-${index}${extension}`;
    const target = path.join(directory, saved);
    let handle;
    try {
      handle = await fs.open(target, 'wx', 0o644);
    } catch (error) {
      if (error.code === 'EEXIST' && !image) continue;
      throw error;
    }
    try {
      await handle.writeFile(bytes);
      await handle.close();
    } catch (error) {
      await handle.close().catch(() => {});
      await fs.unlink(target).catch(() => {});
      throw error;
    }
    return {
      target,
      data: {
        fileName: saved,
        size: bytes.length,
        url: `/uploads/${image ? 'images/' : ''}${encodeURIComponent(saved)}`,
      },
    };
  }
  throw fail(409, '같은 이름의 파일이 너무 많습니다.');
}

export async function saveMultipart(req, { profile } = {}) {
  if (profile !== undefined && profile !== 'image')
    throw fail(400, '지원하지 않는 업로드 profile입니다.');
  const image = profile === 'image';
  const contentType = String(req.headers['content-type'] || '');
  if (!/^multipart\/form-data\s*;/i.test(contentType))
    throw fail(415, 'multipart/form-data로 보내 주세요.');
  const body = await readRawBody(
    req,
    image ? Math.min(IMAGE_BODY_BYTES, generalLimit()) : generalLimit(),
  );
  let form;
  try {
    // Node's maintained parser preserves binary data and quoted multipart boundaries.
    form = await new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    }).formData();
  } catch {
    throw fail(400, '올바르지 않은 multipart 요청입니다.');
  }
  const entries = [...form.entries()];
  const files = entries.filter(([, value]) => typeof value !== 'string' && value.name);
  if (!files.length) throw fail(400, '파일이 없습니다.');
  if (image && (entries.length !== 1 || files[0][0] !== 'file'))
    throw fail(400, 'file 필드로 이미지 한 개를 보내 주세요.');

  // Validate the entire batch before writing any file.
  const prepared = [];
  for (const [, file] of files) {
    if (!file.size) throw fail(400, '빈 파일은 업로드할 수 없습니다.');
    if (image && file.size > IMAGE_MAX_BYTES)
      throw fail(413, '이미지는 5MB 이하여야 합니다.');
    const bytes = Buffer.from(await file.arrayBuffer());
    const format = image ? imageFormat(bytes, file.type) : null;
    prepared.push({
      bytes,
      name: image ? `${randomUUID()}.${format.extension}` : safeName(file.name),
    });
  }
  const written = [];
  try {
    for (const file of prepared)
      written.push(await saveFile(file.name, file.bytes, image));
  } catch (error) {
    await Promise.all(written.map((file) => fs.unlink(file.target).catch(() => {})));
    throw error;
  }
  const data = written.map((file) => file.data);
  return data.length === 1 ? data[0] : { files: data };
}

// Preserve the existing JSON/base64 endpoint and its response fields.
export async function saveBase64({ fileName, fileBase64 } = {}) {
  const name = safeName(fileName);
  if (typeof fileBase64 !== 'string') throw fail(400, 'fileBase64가 필요합니다.');
  const raw = fileBase64.replace(/^data:[^,]*;base64,/, '').replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length % 4 === 1)
    throw fail(400, '올바르지 않은 base64입니다.');
  if (raw.length > Math.ceil(generalLimit() / 3) * 4)
    throw fail(413, '파일이 너무 큽니다.');
  const bytes = Buffer.from(raw, 'base64');
  if (!bytes.length) throw fail(400, '빈 파일입니다.');
  if (bytes.length > generalLimit()) throw fail(413, '파일이 너무 큽니다.');
  return (await saveFile(name, bytes)).data;
}

export function isPublicImageFile(publicDirectory, file) {
  const relative = path.relative(
    path.resolve(publicDirectory, 'uploads', 'images'),
    path.resolve(file),
  );
  return IMAGE_NAME.test(relative);
}

// Services may store only a path issued by the image profile, never an arbitrary URL.
export async function validateImagePath(value) {
  if (value == null || value === '') return null;
  const prefix = '/uploads/images/';
  if (
    typeof value !== 'string' ||
    !value.startsWith(prefix) ||
    !IMAGE_NAME.test(value.slice(prefix.length))
  ) {
    throw fail(400, '올바른 업로드 이미지 경로가 필요합니다.');
  }
  const file = path.join(uploadRoot, 'images', value.slice(prefix.length));
  try {
    if (!(await fs.lstat(file)).isFile()) throw fail(400, '업로드한 이미지가 없습니다.');
  } catch (error) {
    if (error.code === 'ENOENT') throw fail(400, '업로드한 이미지가 없습니다.');
    throw error;
  }
  return value;
}

export async function listUploads() {
  const rows = [];
  for (const directory of [uploadRoot, path.join(uploadRoot, 'images')]) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      const stat = await fs.stat(path.join(directory, entry.name));
      rows.push({
        fileName: entry.name,
        size: stat.size,
        uploadedAt: stat.mtime.toISOString(),
        url: `/uploads/${directory === uploadRoot ? '' : 'images/'}${encodeURIComponent(entry.name)}`,
      });
    }
  }
  return rows.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}
