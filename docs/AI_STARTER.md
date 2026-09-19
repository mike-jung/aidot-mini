# AI API Starter 1.0.10

Starter는 AI가 만든 Controller·Service·named SQL을 작은 소스 환경에서 직접 실행·검증하기 위한 배포물입니다. Full과 같은 공통 런타임과 Note/Product 업무 예제를 사용하며, `@aidot/...` 별칭과 aidot-express 1.45.8의 공통 계약을 유지합니다.

## 포함 범위

API 런타임·컴파일러 의존성 선언·작은 업무 예제·SQL·작성 규칙·실행 검증 도구를 포함합니다. Node 실행 파일, 설치된 npm 의존성, 브라우저 콘솔·Vue·Windows/Linux/Android/ROS 빌드 도구·게시 도구·과거 대용량 검증 자료는 넣지 않습니다. 플랫폼 배포물과 달리 실행 PC에 Node.js 22.19 이상이 필요합니다.

```sh
npm ci --ignore-scripts
npm run workspace:verify -- --workspace ./my-workspace --cases ./my-cases.json
```

실제 생성한 업무 workspace와 예상 응답 사례를 지정합니다. migration이 외부 경로에 있으면 `--migrations ./my-migrations`를 추가합니다. 사례가 없으면 기동·선언 확인만 수행하며 업무 검증 완료로 보고하지 않습니다. 사례를 지정해도 그 사례가 다루지 않는 기능까지 검증한 것은 아닙니다.

## 1.0.8과 플랫폼 배포

1.0.8은 운영체제별 설치/배포 체계를 추가한 버전입니다. Starter에는 해당 플랫폼 도구를 추가하지 않았으며, 동일 소스의 공통 런타임 수정만 반영합니다. 설치형의 AppData 관리 정책과 별개로, Starter를 소스로 실행할 때 기본 상태는 프로젝트 `data/`에 저장됩니다.

`workspace:verify`는 임시 workspace·새 SQLite DB를 사용하고 별도 프로세스에서 컴파일한 뒤 API 서버를 실행합니다. 기존 업무 데이터로 검증하지 않습니다. 컴파일 단계의 메모리 요구량은 존재하며 이 ZIP의 크기가 실행 메모리 상한을 의미하지 않습니다.

## 호환성 및 보고

Controller·Service·SQL은 같은 파일을 mini와 Express에 복사하는 것이 원칙입니다. schema/DDL·DB 종류·환경 설정·계정·업로드는 대상 호스트에서 별도로 준비합니다. SQL dialect나 임의 외부 패키지까지 자동 변환하지 않습니다.

실제 결과는 실행 명령·종료 코드·HTTP 사례/응답 assertion·사용한 OS/Node/DB와 함께 기록합니다. 동봉 Note/Product 검사 통과를 새 업무의 검사로 대신하지 않습니다. [작성 규칙](AI_API_RULES.md)과 [이식 지침](PORTING.md)을 따릅니다.
