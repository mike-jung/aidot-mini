/**
 * requestContext.js — 요청 하나의 생애를 하나의 ID 로 묶는다.
 *
 *  aidot-express v1.8.0 에서 값이 증명된 기능을 최소 형태로 옮겼다.
 *  로그가 요청 단위로 묶이지 않으면, 동시 요청이 겹치는 순간 추적이 사실상 불가능하다.
 *
 *  Node 내장 `AsyncLocalStorage` 만 쓴다 (별도 라이브러리 불필요).
 *
 *  ⚠ 대표적 함정: 요청 중 등록한 EventEmitter 리스너가 나중에 실행되면 컨텍스트가 빈다.
 *    그래서 모든 조회 함수는 컨텍스트 밖에서 **던지지 않고 null 을 돌려준다.**
 *    추적이 없다고 요청이 깨지면 안 된다.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import config from '../config.js';

const storage = new AsyncLocalStorage();
const MAX_STEPS = 100;

/** W3C traceparent: 00-<32hex>-<16hex>-<2hex> */
const TP = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export function createContext(req) {
  const tp = req?.headers?.traceparent;
  const m = tp && TP.exec(String(tp).trim().toLowerCase());
  const inherited = m && m[1] !== '0'.repeat(32) && m[2] !== '0'.repeat(16) ? m[1] : null;

  const given = String(req?.headers?.['x-request-id'] || '').trim();
  const requestId = /^[0-9a-zA-Z_-]{4,64}$/.test(given) ? given : crypto.randomBytes(4).toString('hex');

  return {
    requestId,
    traceId: inherited || crypto.randomBytes(16).toString('hex'),
    spanId: crypto.randomBytes(8).toString('hex'),
    method: req?.method, path: req?.url,
    startedAt: Date.now(),
    steps: [], truncated: false, user: null,
  };
}

export const runWith = (ctx, fn) => storage.run(ctx, fn);
export const getContext = () => storage.getStore() ?? null;
export const currentRequestId = () => storage.getStore()?.requestId ?? null;

export function addStep(kind, name, info = {}) {
  const ctx = storage.getStore();
  if (!ctx || !config.trace.enabled) return;
  if (ctx.steps.length >= MAX_STEPS) { ctx.truncated = true; return; }
  ctx.steps.push({ at: Date.now() - ctx.startedAt, kind, name: String(name).slice(0, 200), ...info });
}

/** 밖으로 나가는 호출에 붙일 W3C 헤더 */
export function outboundHeaders() {
  const c = storage.getStore();
  return c ? { traceparent: `00-${c.traceId}-${c.spanId}-01`, 'X-Request-Id': c.requestId } : {};
}

export default { createContext, runWith, getContext, currentRequestId, addStep, outboundHeaders };
