/**
 * state.js — 기동/종료 상태 한 곳.
 *  readiness 판정과 안전한 종료가 같은 값을 봐야 하므로 별도 모듈로 둔다.
 */
import fs from 'node:fs';
const {version} = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const state = {
  version,
  draining: false,        // 종료 절차 시작 — 즉시 트래픽을 끊어야 한다
  migrationOk: false,
  startedAt: Date.now(),
  markDraining() { this.draining = true; },
};
export default state;
