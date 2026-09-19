import { Controller, PostMapping, GetMapping, Roles } from '../core/decorators.js';
import { saveBase64, saveMultipart, listUploads } from '../core/uploads.js';

@Controller('/api/uploads')
export default class UploadController {
  @PostMapping('/')
  @Roles('admin')
  async upload(params) {
    return { data: await saveBase64(params) };
  }

  // Existing multipart API; ?profile=image adds validated public image storage.
  @PostMapping('/multipart')
  @Roles('admin')
  async uploadMultipart(params, req) {
    return { data: await saveMultipart(req, { profile: params.profile }) };
  }

  @GetMapping('/')
  @Roles('admin')
  async list() {
    return { data: await listUploads() };
  }
}
