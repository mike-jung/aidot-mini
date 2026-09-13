/**
 * query, body, url(params) 를 하나의 객체 `req.params_` 로 병합.
 * 우선순위: path params > body > query (path가 가장 강함)
 *
 * 컨트롤러 핸들러에는 (params, req, res, next) 로 넘겨준다.
 */
export function mergeParams(req) {
  return {
    ...(req.query || {}),
    ...(req.body || {}),
    ...(req.params || {}),
  };
}
