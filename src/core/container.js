/**
 * 아주 단순한 DI 컨테이너.
 * - register(name, instance): 인스턴스 등록
 * - registerFactory(name, factoryFn): lazy 인스턴스
 * - resolve(name): 꺼내기
 */
class Container {
  constructor() {
    this.instances = new Map();
    this.factories = new Map();
  }
  register(name, instance) {
    this.instances.set(name, instance);
  }
  registerFactory(name, factory) {
    this.factories.set(name, factory);
    // 같은 이름의 캐시된 인스턴스가 있으면 제거 (hot-reload 시 다음 resolve 에서 새 인스턴스 생성)
    if (this.instances.has(name)) this.instances.delete(name);
  }
  has(name) {
    return this.instances.has(name) || this.factories.has(name);
  }
  resolve(name) {
    if (this.instances.has(name)) return this.instances.get(name);
    if (this.factories.has(name)) {
      const inst = this.factories.get(name)();
      this.instances.set(name, inst);
      return inst;
    }
    throw new Error(`[DI] '${name}' 빈을 찾을 수 없습니다. @Service 등록 여부를 확인하세요.`);
  }
  list() {
    return [
      ...this.instances.keys(),
      ...[...this.factories.keys()].filter((k) => !this.instances.has(k)),
    ];
  }
}

const container = new Container();
export default container;
