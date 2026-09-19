# 1.0.7 Full·AI Starter·RULES 갱신 내역

이번 수정본은 첨부 Full 0.6.2와 Starter 1.0.5, API Product v2, Frontend Product v1을 통합·갱신한 결과다. 런타임은 앞서 검증한 mini 1.0.6 수정본을 유지하고, Express 기준은 첨부 1.45.8 Full을 유지했다. 1.0.7은 이번 검토 수정본을 구분하는 버전이며 GitHub 공식 릴리스를 발행한 것은 아니다.

Starter의 목적은 **AI가 만든 Controller·Service·SQL을 작은 실행 환경에서 검증하는 것**이다. Full의 화면 실습·배포 기능을 담은 축소 복사본으로 취급하지 않는다. RULES는 AI가 따라야 하는 생성 계약과 검증 절차다.

## 배포물 구분

| 배포물 | 포함 범위와 용도 |
|---|---|
| Full 1.0.7 | 전체 서버·관리 콘솔·Note·Product·Vue 예제·장치/게시 도구·문서. 개발 및 전체 기능 사용 |
| AI Starter 1.0.7 | 공통 API 런타임·컴파일러 의존성 선언·작은 업무 예제/SQL·API RULES·실행 검증 도구. AI가 생성한 업무 코드 확인 |
| API RULES Product v3 | 이식 가능한 업무 파일 구조·import·주입·입력·DB·응답·권한 및 실제 실행 합격 기준 |
| Frontend RULES Product v2 | Full의 Vue 클라이언트 또는 별도 프런트엔드 프로젝트에서 적용할 API 연동·상태·폼·비동기 처리 규칙 |

Starter에는 Vue 클라이언트, 브라우저 관리 콘솔 정적 파일, 스크린샷, 슬라이드, 장치 빌드, 게시 도구, 과거 검증 로그를 넣지 않는다. HTTP API와 관리자 검증 API는 공통 런타임 그대로 사용한다. Starter에서 웹 루트의 콘솔 화면을 기대하지 않는다. 프런트엔드 개발은 Full의 `examples/product-client` 또는 별도 클라이언트를 사용한다.

## 원본별 판단과 수정 방향

| 발견 내용 | 수정 대상과 처리 |
|---|---|
| 첨부 Full 0.6.2의 모든 src 파일은 공개 mini 1.0.1과 동일 | Full 전용 기능만 복원하고 1.0.6에서 해결한 loader·권한·업로드·Product 수정은 유지 |
| 앞선 공개 GitHub 기반 Full에는 비공개 게시 도구가 없음 | 이번 Full에 scripts/publish와 검증 fixture·에디션 경계 문서를 통합 |
| 기존 Starter는 17 MB급이며 AI 업무 코드 검증에 불필요한 Vue 자산까지 포함 | AI 실행용 정확한 파일 목록으로 재구성. Full과 같은 런타임과 업무 파일을 사용 |
| 기존 Starter builder는 Full의 edition과 모든 docs를 상속 | Public 에디션의 Starter로 명시하고 독립 README·명시적 파일 정책을 사용 |
| 고정된 Product 테스트만으로는 AI가 새로 만든 업무 코드를 검사할 수 없음 | workspace:verify로 지정 workspace를 임시 복사해 기동·metadata·사용자 JSON HTTP 사례를 확인 |
| 기동 성공을 업무 성공으로 잘못 보고할 가능성 | 업무 요청 수와 실제 assertion을 별도로 출력. 사례를 주지 않으면 업무 검증 미실행으로 표시 |
| API RULES의 호스트 종속 import·권한 안내가 공통 계약과 어긋남 | @aidot 별칭, admin realm+roles, 함수 인수·DB 반환·생성 파일·검증 방법을 명시 |
| Frontend RULES만 따르면 지연 응답이나 재사용 route에서 오래된 화면을 수정할 수 있음 | 요청 순번, 화면 수명, route 변경, 인증 복원 순서, 업로드 URL 재사용 명시 |
| Full/Public 파일 목록에 오래된 캐시가 있고 Product 경로가 빠짐 | 캐시·상태 제외, Product 전체 포함. 정확한 파일 경로 목록·SHA-256 검사를 유지 |
| Full의 클라이언트에는 2 MiB를 초과하는 기존 번들 3개가 있음 | Public export에서 정확한 경로·크기·해시로 세 파일만 허용. AI Starter에는 모두 제외 |
| 원본에 오래된 Android 서버 ZIP이 포함됨 | 현재 소스에서 npm run android:assets로 재생성하도록 제외 |

## AI 코드 생성·실행 절차

1. AI에게 API RULES와 요구사항을 전달한다. 필요할 때 Starter 소스의 작은 업무 예제를 참고하게 한다.
2. `controller/`, `service/`, `sql/` 파일을 생성한다. 필요한 DB migration과 정상·오류·권한 검증 사례 JSON도 함께 만든다.
3. Starter 루트에서 `npm ci --ignore-scripts`를 한 번 실행한다. 설치된 의존성을 매 검증마다 다시 설치할 필요는 없다.
4. 아래처럼 자신의 workspace와 migration, HTTP 사례를 지정한다. 임시 작업 공간과 DB를 사용하고 종료 후 정리한다. 검증기는 별도 프로세스에서 해당 업무 선언을 먼저 컴파일하고 종료한 뒤 API 서버를 시작하여 컴파일러와 서버의 메모리 수명을 분리한다.
5. 결과에서 기동·선언 검증과 업무 HTTP 검증을 구분한다. 실패 시 코드를 수정한 뒤 같은 사례를 다시 실행한다.

```sh
npm run workspace:verify -- --workspace examples/product-workspace --migrations examples/product-database --cases docs/AI_WORKSPACE_CASES.json
```

위 예시는 Product용 10개 사례다. 새 업무 코드에는 URL·본문·예상 상태·응답 subset을 해당 요구사항에 맞춰 새로 작성한다. Product 예제의 사례 통과를 다른 업무 코드의 검증으로 보고하지 않는다. 모든 작업에 거대한 전체 회귀 검증을 반복할 필요는 없으며, 프레임워크나 공통 계약을 변경한 경우 Full의 회귀 검증을 사용한다.

## 적용 및 유지보수

- 새 설치: 전체 개발·화면·배포 도구는 Full, AI 서버 코드 실행 확인은 Starter를 사용한다.
- 원본별 patch는 각각 첨부 Full 0.6.2와 Starter 1.0.5에만 적용한다. 기본 명령은 dry-run이며 --apply는 원본 해시 검사 후 백업하고 변경한다. Starter 패치는 불필요한 원본 Vue·정적 자산도 백업 후 제거한다. 사용자 소스 변경이 있으면 중단한다.
- 두 패치는 이전 1.0.6 결과물용이 아니다. 이미 1.0.6을 사용한다면 새 패키지에 사용자 workspace·설정을 이관하거나 변경 파일을 비교한다.
- `.env`·DB·계정·업로드·node_modules·컴파일 캐시는 배포에 넣지 않는다. 기존 사용자의 실행 상태를 패치 payload로 덮어쓰지 않는다.
- Controller·Service·SQL은 mini와 첨부 Express 1.45.8에서 동일 파일을 사용한다. DB 스키마·설정·계정·업로드 이전은 소스 복사와 별도 작업이다. Express에는 추가 패치를 덧씌우지 않는다.
- Full에서 새 배포 파일을 추가하면 Full/Public/Starter의 각 허용 목록을 검토한다. 이전 슬라이드와 1.0.6 기록은 과거 자료로 표시한다.

용량 축소는 압축 크기·파일 수·AI가 읽고 검사하는 범위를 줄인다. 추가로 범용 검증기의 사전 컴파일 프로세스를 분리해 서버 단계에서 컴파일러 메모리를 유지하지 않도록 했다. 공통 런타임은 변경하지 않았으며 일반 npm start의 메모리 동작도 유지된다. 컴파일 단계의 순간 메모리 요구량은 여전히 존재하고, 아직 캐시에 없는 동적 helper를 런타임이 컴파일할 수도 있다. 실제 측정 환경·RSS와 실행 결과는 `VERIFICATION_1.0.7.md`에 기록한다. Windows·Android·ROS 실기기, 실제 MariaDB, 원격 GitHub 게시를 이번에 실행했다고 주장하지 않는다.
