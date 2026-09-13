import container from './container.js';
import { addStep } from './requestContext.js';
import sqlRegistry from './sqlLoader.js';
import logger, { forService } from '../util/logger.js';

/** 내부 키 */
export const META = {
  IS_CONTROLLER: '__isController',
  BASE_PATH: '__basePath',
  ROUTES: '__routes',
  IS_SERVICE: '__isService',
  SERVICE_NAME: '__serviceName',
};

/* =========================================================
 * 클래스 데코레이터: @Controller(basePath?)
 * ========================================================= */
export function Controller(basePath = '') {
  return function (target) {
    target[META.IS_CONTROLLER] = true;
    target[META.BASE_PATH] = basePath;
    if (!target[META.ROUTES]) target[META.ROUTES] = [];
    return target;
  };
}

/* =========================================================
 * 메서드 데코레이터: @RequestMapping({ path, method })
 *   - method: 'get' | 'post' | 'put' | 'patch' | 'delete' | 'all'
 * 편의 별칭: @GetMapping, @PostMapping, @PutMapping, @PatchMapping, @DeleteMapping
 * ========================================================= */
export function RequestMapping(arg = {}) {
  // @RequestMapping('/path') 또는 @RequestMapping({path, method})
  const opts = typeof arg === 'string' ? { path: arg, method: 'get' } : arg;
  const path = opts.path ?? '';
  const method = (opts.method ?? 'get').toLowerCase();

  return function (target, propertyKey /*, descriptor */) {
    const ctor = target.constructor;
    if (!Object.prototype.hasOwnProperty.call(ctor, META.ROUTES)) {
      ctor[META.ROUTES] = [];
    }
    ctor[META.ROUTES].push({ path, method, handler: propertyKey });
  };
}

const makeMethodDecorator = (method) => (path = '') =>
  RequestMapping({ path, method });

/**
 * @SseMapping('/stream') — Server-Sent Events 스트림 라우트.
 *
 *  일반 @GetMapping 과 다른 점 (controllerLoader 가 처리):
 *   - 응답을 JSON 봉투로 감싸지 않고 스트림으로 전환한다 (Content-Type: text/event-stream).
 *   - 하트비트·재전송·연결 정리는 src/core/sse.js 의 허브가 담당한다.
 *   - 핸들러가 채널 이름(문자열) 또는 { channel, ... } 를 반환하면 그 채널에 자동 구독시킨다.
 *   - EventSource 는 Authorization 헤더를 못 보내므로, @Auth() 와 함께 쓰면
 *     ?access_token=... 쿼리 파라미터도 토큰으로 인정한다 (로그에는 마스킹되어 남는다).
 *
 *  예)
 *    @SseMapping('/stream')
 *    async stream(params) { return params.channel || 'demo'; }
 */
export function SseMapping(path = '') {
  return function (target, propertyKey /*, descriptor */) {
    const ctor = target.constructor;
    if (!Object.prototype.hasOwnProperty.call(ctor, META.ROUTES)) ctor[META.ROUTES] = [];
    ctor[META.ROUTES].push({ path, method: 'get', handler: propertyKey, sse: true });
    if (!Object.prototype.hasOwnProperty.call(ctor, '__sse')) ctor.__sse = {};
    ctor.__sse[propertyKey] = true;
  };
}

export const GetMapping = makeMethodDecorator('get');
export const PostMapping = makeMethodDecorator('post');
export const PutMapping = makeMethodDecorator('put');
export const PatchMapping = makeMethodDecorator('patch');
export const DeleteMapping = makeMethodDecorator('delete');

/* =========================================================
 * 메서드 데코레이터: @Validate(schema)
 *  - Zod 스키마로 핸들러의 `params` 를 검증.
 *  - 검증 실패 시 400 Bad Request + 필드별 에러 반환.
 *  - 검증 통과 후 핸들러의 `params` 는 zod 가 가공한(coerce/trim 등) 값으로 교체.
 *
 *  클래스 메타에 validators[handlerName] = schema 형태로 저장하고
 *  controllerLoader 에서 래핑 시 참조.
 * ========================================================= */
/* =========================================================
 * 메서드 데코레이터: @Auth(opts?)
 *  - 해당 핸들러 호출 전에 Authorization: Bearer <access_token> 검증.
 *  - 검증 통과 시 req.user = { id, role } 채워짐.
 *  - opts.roles: ['admin', ...] 로 역할 제한 가능.
 *
 *  클래스 메타에 guards[handlerName] = opts 저장.
 * ========================================================= */
export function Auth(opts = {}) {
  return function (target, propertyKey) {
    if(typeof target==='function')throw new Error('@Auth belongs on methods for aidot-express 1.45.1 compatibility');
    const ctor = target.constructor;
    if (!Object.prototype.hasOwnProperty.call(ctor, '__guards')) {
      ctor.__guards = {};
    }
    ctor.__guards[propertyKey] = { type: 'auth', ...opts };
  };
}

/* =========================================================
 * 메서드 데코레이터: @Roles('admin', 'staff')
 *  - req.user.role 이 허용 목록에 없으면 403.
 *  - 내부적으로 @Auth 도 자동 요구.
 * ========================================================= */
export function Roles(...roleList) {
  const flat = roleList.flat();
  return function (target, propertyKey) {
    const ctor = target.constructor;
    if (!Object.prototype.hasOwnProperty.call(ctor, '__guards')) {
      ctor.__guards = {};
    }
    const existing = ctor.__guards[propertyKey] ?? { type: 'auth' };
    ctor.__guards[propertyKey] = { ...existing, type: 'auth', roles: flat };
  };
}

export function Validate(schema) {
  return function (target, propertyKey) {
    const ctor = target.constructor;
    if (!Object.prototype.hasOwnProperty.call(ctor, '__validators')) {
      ctor.__validators = {};
    }
    ctor.__validators[propertyKey] = schema;
  };
}

/* =========================================================
 * 클래스 데코레이터: @Service(name?)
 *  - 서비스 클래스는 자동으로 싱글톤으로 컨테이너 등록.
 *  - name 생략 시 클래스명이 키.
 * ========================================================= */
export function Service(name) {
  return function (target) {
    const beanName = name ?? target.name;
    target[META.IS_SERVICE] = true;
    target[META.SERVICE_NAME] = beanName;
    // factory 등록: controllerLoader 가 import 할 때 등록됨
    container.registerFactory(beanName, () => new target());
    return target;
  };
}

/* =========================================================
 * 프로퍼티 데코레이터: @Autowired(name?)
 *  - 클래스 필드에 붙이면 접근 시 컨테이너에서 해결.
 *  - name 생략 시 프로퍼티 이름(PascalCase 변환)을 키로 사용.
 *     예: userService -> UserService
 * ========================================================= */
/**
 * ★ v1.10.35 — 주입된 서비스를 감싸 **메서드 호출을 단계로 남긴다.**
 *
 *  생성 코드에 `addStep()` 을 넣는 방법도 있지만, 그러면 v1.10.31 에서
 *  겪은 그대로 **이미 만들어 둔 서비스는 그대로**다. 주입 지점을 감싸면
 *  기존 파일을 하나도 고치지 않고 전부 기록된다.
 *
 *  ⚠ 감싸는 비용을 낮게 유지한다:
 *   · 프로토타입의 함수만 감싼다(속성 접근마다 새 함수를 만들지 않도록 캐시)
 *   · 실패해도 원래 호출은 그대로 진행한다 — 추적이 기능을 깨면 안 된다
 */
const __tracedServices = new WeakMap();

function traceService(svc, svcName) {
  if (!svc || typeof svc !== 'object') return svc;
  const hit = __tracedServices.get(svc);
  if (hit) return hit;

  const proxy = new Proxy(svc, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v !== 'function' || typeof prop !== 'string') return v;
      if (prop.startsWith('_') || prop === 'constructor') return v;
      return function (...args) {
        const started = Date.now();
        let out;
        try {
          out = v.apply(target, args);
        } catch (e) {
          addStep('service', `${svcName}.${prop}`, {
            ms: Date.now() - started, ok: false, detail: String(e.message).slice(0, 200),
          });
          throw e;
        }
        // 비동기면 끝난 뒤에 재야 실제 소요가 나온다
        if (out && typeof out.then === 'function') {
          return out.then(
            (r) => { addStep('service', `${svcName}.${prop}`, { ms: Date.now() - started }); return r; },
            (e) => {
              addStep('service', `${svcName}.${prop}`, {
                ms: Date.now() - started, ok: false, detail: String(e?.message ?? e).slice(0, 200),
              });
              throw e;
            },
          );
        }
        addStep('service', `${svcName}.${prop}`, { ms: Date.now() - started });
        return out;
      };
    },
  });
  __tracedServices.set(svc, proxy);
  return proxy;
}

export function Autowired(name) {
  return function (target, propertyKey) {
    const resolved =
      name ?? propertyKey.charAt(0).toUpperCase() + propertyKey.slice(1);
    const ctor=target.constructor;if(!Object.hasOwn(ctor,'__miniDependencies'))ctor.__miniDependencies=[];ctor.__miniDependencies.push(resolved);
    Object.defineProperty(target, propertyKey, {
      configurable: true,
      enumerable: true,
      get() {
        const svc = container.resolve(resolved);
        try { return traceService(svc, resolved); } catch { return svc; }
      },
    });
  };
}

/* =========================================================
 * 프로퍼티 데코레이터: @Sql('파일이름')
 *  - SQL 파일 객체를 주입.
 *  - 사용 예) this.userSql.get('findById') 또는 this.userSql.run(db, 'findById', params)
 *  - 또는 파라미터 없이 @Sql 만 사용 시 전역 레지스트리 객체 주입
 *     this.sql.run('user:findById', params)
 * ========================================================= */
export function Sql(fileName) {
  // 데코레이터 팩토리와 데코레이터 직접 사용 모두 지원
  // @Sql('user') - 팩토리 형태
  // @Sql         - 직접 형태 (target, key, desc로 호출됨)
  if (typeof fileName === 'object' || arguments.length >= 2) {
    // 직접 사용
    const target = arguments[0];
    const propertyKey = arguments[1];
    Object.defineProperty(target, propertyKey, {
      configurable: true,
      enumerable: true,
      get() {
        return sqlRegistry;
      },
    });
    return;
  }
  return function (target, propertyKey) {
    const ctor=target.constructor;
    if(!Object.hasOwn(ctor,'__miniSqlBindings'))ctor.__miniSqlBindings={...ctor.__miniSqlBindings};
    ctor.__miniSqlBindings[propertyKey]=fileName;
    Object.defineProperty(target, propertyKey, {
      configurable: true,
      enumerable: true,
      get() {
        return sqlRegistry.getFile(fileName);
      },
    });
  };
}

/* =========================================================
 * 프로퍼티 데코레이터: @Log
 *  - logger 주입 ( this.log.info('...') )
 *  - admin 파일(lib/admin/service 또는 controller) 에 있는 클래스에는
 *    config.log.admin=false 일 때 no-op logger 를 주입하여
 *    admin 관련 서비스 로그를 통째로 억제.
 *  - 판정 근거: 이 데코레이터가 실행된 call stack 의 "사용자 파일" 프레임.
 *    (데코레이터는 클래스 선언 시 1회만 실행되므로 스택에서 해당 파일 경로를
 *     얻으면 그대로 클래스가 선언된 파일.)
 * ========================================================= */
function detectDeclaringFile() {
  const stack = new Error().stack || '';
  const lines = stack.split('\n').slice(1);
  // 'at Foo (file:///... .js:10:5)' 또는 'at /abs/foo.js:10:5'
  const re = /\(?(file:\/\/[^)]+|\/[^\s()]+|[A-Za-z]:[\\/][^\s()]+):\d+:\d+\)?$/;
  for (const line of lines) {
    const m = line.match(re);
    if (!m) continue;
    const raw = m[1];
    if (raw.includes('/node_modules/') || raw.includes('\\node_modules\\')) continue;
    if (raw.endsWith('decorators.js')) continue;
    return raw;
  }
  return null;
}

export function Log(target, propertyKey) {
  const declaringFile = detectDeclaringFile();
  const injected = declaringFile ? forService(declaringFile) : logger;
  Object.defineProperty(target, propertyKey, {
    configurable: true,
    enumerable: true,
    get() {
      return injected;
    },
  });
}
