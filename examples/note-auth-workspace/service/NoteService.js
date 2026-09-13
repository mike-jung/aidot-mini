///
/// NoteService
/// My Note Service
///

import { Service, Sql, Log } from '../../src/core/decorators.js';
import db from '../../src/database/db.js';
import { fillPlaceholders } from '../../src/core/sqlLoader.js';


@Service('NoteService')
export default class NoteService {

  // SQL 파일 주입: src/database/sql/note.sql
  @Sql('note') noteSql;

  @Log log;

  // 전체 조회
  async list() {
    this.log.info(`${this.constructor.name}::list 호출됨`);
    const sql = this.noteSql.get('findAll');
    const res = await db.execute(sql, {});
    return res.rows;
  }

  // 단건 조회
  async getById(id) {
    this.log.debug(`${this.constructor.name}::getById 호출됨 -> id=${id}`);
    const sql = this.noteSql.get('findById');
    const res = await db.execute(sql, { id });
    return res.rows[0] ?? null;
  }

  // 생성
  async create(payload) {
    this.log.info(`${this.constructor.name}::create 호출됨`);
    const sql = this.noteSql.get('insert');
    const res = await db.execute(sql, payload);
    return { insertId: res.insertId, rowsAffected: res.rowsAffected };
  }

  // 수정
  async update(params) {
    this.log.info(`${this.constructor.name}::update 호출됨 -> id=${params?.id}`);
    const sql = this.noteSql.get('update');
    const res = await db.execute(sql, fillPlaceholders(sql, params));
    return { rowsAffected: res.rowsAffected };
  }

  // 삭제
  async remove(id) {
    this.log.info(`${this.constructor.name}::remove 호출됨 -> id=${id}`);
    const sql = this.noteSql.get('deleteById');
    const res = await db.execute(sql, { id });
    return { rowsAffected: res.rowsAffected };
  }
}
