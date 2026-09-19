import {
  Controller,
  GetMapping,
  PostMapping,
  PutMapping,
  DeleteMapping,
  Autowired,
  Auth,
} from '@aidot/core/decorators.js';

@Controller('/api/product')
export default class ProductController {
  @Autowired('ProductService') productService;

  @GetMapping('/')
  async list() {
    return this.productService.list();
  }

  // 고정 경로 /paged를 /:id보다 먼저 선언합니다.
  @GetMapping('/paged')
  async listPaged(params) {
    return this.productService.listPaged(params);
  }

  @GetMapping('/:id')
  async get(params) {
    return this.productService.getById(params.id);
  }

  @PostMapping('/')
  @Auth({ realm: 'admin', roles: ['admin'] })
  async create(params, req, res) {
    const data = await this.productService.create(params);
    res.status(201).json({
      code: 201,
      message: 'Created',
      header: {
        requestCode: params.requestCode || null,
        timestamp: new Date().toLocaleString('sv-SE', {
          timeZone: 'Asia/Seoul',
          hour12: false,
        }),
      },
      data,
    });
  }

  @PutMapping('/:id')
  @Auth({ realm: 'admin', roles: ['admin'] })
  async update(params) {
    return this.productService.update(params);
  }

  @DeleteMapping('/:id')
  @Auth({ realm: 'admin', roles: ['admin'] })
  async remove(params) {
    return this.productService.remove(params.id);
  }
}
