///
/// NoteController
/// My Note API
///

import {
  Controller,
  Log,
  GetMapping,
  PostMapping,
  PutMapping,
  DeleteMapping,
  Autowired,
} from '@aidot/core/decorators.js';


@Controller('/api/notes')
export default class NoteController {

  @Autowired('NoteService') noteService;

  @Log log;

  // 1. GET /api/notes/  →  NoteController.list
  @GetMapping('/')
  async list(params) {
    this.log.info(`${this.constructor.name}::list 호출됨`);
    const result = await this.noteService.list();
    return result;
  }

  // 2. GET /api/notes/:id  →  NoteController.get
  @GetMapping('/:id')
  async get(params) {
    this.log.info(`${this.constructor.name}::get 호출됨 -> id=${params.id}`);
    const result = await this.noteService.getById(params.id);
    if (result === null || result === undefined) throw Object.assign(new Error(`id ${params.id} 을(를) 찾을 수 없습니다`), { status: 404 });
    return result;
  }

  // 3. POST /api/notes/  →  NoteController.create
  @PostMapping('/')
  async create(params, req, res) {
    this.log.info(`${this.constructor.name}::create 호출됨 -> params=${JSON.stringify(params)}`);
    const result = await this.noteService.create(params);
    res.status(201).json({
      code: 201, message: 'Created',
      header: {
        requestCode: params.requestCode || null,
        timestamp: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul', hour12: false }).replace('T', ' '),
      },
      data: result,
    });
  }

  // 4. PUT /api/notes/:id  →  NoteController.update
  @PutMapping('/:id')
  async update(params) {
    this.log.info(`${this.constructor.name}::update 호출됨 -> id=${params.id}`);
    return this.noteService.update(params);
  }

  // 5. DELETE /api/notes/:id  →  NoteController.remove
  @DeleteMapping('/:id')
  async remove(params) {
    this.log.info(`${this.constructor.name}::remove 호출됨 -> id=${params.id}`);
    return this.noteService.remove(params.id);
  }
}
