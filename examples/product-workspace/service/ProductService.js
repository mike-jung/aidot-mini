import { Service, Sql } from '@aidot/core/decorators.js';
import db from '@aidot/database/db.js';
import { validateImagePath } from '@aidot/core/uploads.js';

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function positiveInteger(value, name, fallback, maximum) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!['string', 'number'].includes(typeof value) || !/^[1-9]\d*$/.test(String(value))) {
    throw httpError(400, `${name}은 양의 정수여야 합니다.`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > maximum) {
    throw httpError(400, `${name}은 1~${maximum} 범위여야 합니다.`);
  }
  return number;
}

function productPayload(input) {
  if (
    typeof input.name !== 'string' ||
    !input.name.trim() ||
    input.name.trim().length > 100
  ) {
    throw httpError(400, '상품 이름은 1~100자로 입력해 주세요.');
  }
  if (
    typeof input.price !== 'number' ||
    !Number.isSafeInteger(input.price) ||
    input.price < 0 ||
    input.price > 1000000
  ) {
    throw httpError(400, '가격은 0~1,000,000 범위의 정수여야 합니다.');
  }
  if (input.memo != null && (typeof input.memo !== 'string' || input.memo.length > 500)) {
    throw httpError(400, '설명은 500자 이내로 입력해 주세요.');
  }
  return {
    name: input.name.trim(),
    price: input.price,
    memo: input.memo?.trim() || null,
  };
}

// SQL 식별자는 바인딩할 수 없으므로 정렬식을 코드의 허용 목록으로 제한합니다.
// 같은 가격/이름 사이에도 id로 순서를 고정해야 페이지 결과가 안정적입니다.
const SORT_ORDERS = Object.freeze({
  newest: 'id DESC',
  name: 'name ASC, id ASC',
  priceAsc: 'price ASC, id ASC',
  priceDesc: 'price DESC, id DESC',
});

function parseId(value) {
  return positiveInteger(value, 'id', undefined, Number.MAX_SAFE_INTEGER);
}

@Service('ProductService')
export default class ProductService {
  @Sql('product')
  productSql;

  async list() {
    const sql = this.productSql.get('findAll');
    const result = await db.execute(sql, {});

    return result.rows;
  }

  async listPaged({ page, perPage, q = '', sort = 'newest' } = {}) {
    // 1. query string의 숫자는 문자열이므로 먼저 범위를 검증합니다.
    const currentPage = positiveInteger(page, 'page', 1, 1000000);
    const pageSize = positiveInteger(perPage, 'perPage', 10, 100);

    if (typeof q !== 'string' || q.trim().length > 100) {
      throw httpError(400, '검색어는 100자 이내여야 합니다.');
    }

    if (typeof sort !== 'string' || !Object.hasOwn(SORT_ORDERS, sort)) {
      throw httpError(400, '지원하지 않는 정렬입니다.');
    }

    // 2. 검색어는 값으로 바인딩합니다. %, _도 글자 그대로 검색합니다.
    const escapedQuery = q.trim().replace(/[!%_]/g, (character) => '!' + character);
    const keyword = `%${escapedQuery}%`;
    const sql = `${this.productSql.get('findPaged')}\nORDER BY ${SORT_ORDERS[sort]}`;

    // 3. count/LIMIT/OFFSET은 프레임워크가 처리합니다.
    // rows만 꺼내지 않아야 Controller가 header와 data를 함께 응답합니다.
    return db.executeList(
      sql,
      { keyword },
      {
        page: currentPage,
        perPage: pageSize,
        maxPerPage: 100,
      },
    );
  }

  async getById(id) {
    const sql = this.productSql.get('findById');
    const result = await db.execute(sql, { id: parseId(id) });
    const product = result.rows[0];

    if (!product) {
      throw httpError(404, '상품을 찾을 수 없습니다.');
    }

    return product;
  }

  async create(input) {
    const values = productPayload(input);
    values.imagePath = await validateImagePath(input.imagePath);

    const sql = this.productSql.get('insert');
    const result = await db.execute(sql, values);

    return {
      insertId: result.insertId,
      rowsAffected: result.rowsAffected,
    };
  }

  async update(input) {
    const existing = await this.getById(input.id);
    const values = { ...productPayload(input), id: existing.id };

    // imagePath 생략: 기존 이미지 유지. null 또는 빈 문자열: 이미지 연결 해제.
    values.imagePath =
      input.imagePath === undefined
        ? existing.imagePath
        : await validateImagePath(input.imagePath);

    const sql = this.productSql.get('update');
    const result = await db.execute(sql, values);

    return { rowsAffected: result.rowsAffected };
  }

  async remove(id) {
    const product = await this.getById(id);
    const sql = this.productSql.get('deleteById');
    const result = await db.execute(sql, { id: product.id });

    // 공개 파일은 다른 레코드에서 참조할 수 있어 여기서 자동 삭제하지 않습니다.
    return { rowsAffected: result.rowsAffected };
  }
}
