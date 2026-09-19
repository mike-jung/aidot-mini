# 1.0.7 실행 검증 기록

2026-09-18, Linux x64, Node 24.19.0, npm 11.9.0, SQLite에서 직접 실행했다. Express 기준은 첨부 Full 1.45.8이다. 의존성은 lockfile 버전을 유지했으며 이번 기록은 과거 1.0.6의 실행 수치를 합산하지 않는다.

## 서버·클라이언트 결과

| 검증 대상 | 실제 결과 |
|---|---|
| 통합 Full `npm run verify` | 문법 131/131, metadata 계약, 회귀 테스트 122/122, Product HTTP 56 통과 |
| Full/Public 게시 도구 | 12/12 통과. 임시 로컬 bare Git만 사용, 원격 GitHub push 없음 |
| 최소 Starter 새 설치 | `npm ci --ignore-scripts --offline` 성공 |
| 최소 Starter `npm run verify` | 문법 59/59, Note HTTP 15, Product HTTP 56 통과 |
| 최소 Starter 자체 재생성 | 추출된 Starter에서 재빌드 후 111개 파일 내용 일치 |
| 콘솔 없는 API 기동 | 루트 404, Note 200, 관리자 API 익명 401·인증 200 확인 |
| 범용 workspace 검증 | 생성형 Hello Controller·Service·SQL 대상 테스트 3/3 통과. 임시 DB, 인증, 응답, 원본 보존, 실패 종료 확인 |
| 동봉 Product JSON 사례 | 정상·권한 거절·등록·조회·수정·입력 오류·삭제·미존재 10/10 통과 |
| mini의 동일 업무 파일 교차 계약 | 86개 검사 / HTTP 112회 통과 |
| Express의 동일 업무 파일 교차 계약 | 88개 검사 / HTTP 118회 통과 |
| 내장 Vue 클라이언트 | 새 설치, format:check, build 성공. mini 모드 7/7, Express 모드 7/7 테스트 통과 |
| RULES 코드 예시 | JS/Vue 블록 8개 컴파일 및 SQL 블록 SQLite 실행 확인 |

메모리 개선을 적용한 범용 검증기는 별도 테스트 3/3과 실제 Starter에서 다시 실행했다. 전체 서버 핵심 런타임과 업무 파일은 그대로다.

범용 검증기 테스트는 잘못된 assertion·문법 오류가 실패 종료하는지, cases 생략 시 `businessVerified:false`인지도 확인한다. 기본 제공 Note/Product 테스트의 성공이 다른 생성 코드의 성공을 의미하지 않는다. 생성할 때마다 해당 업무의 HTTP cases를 함께 작성·실행해야 한다.

```sh
npm ci --ignore-scripts
npm run workspace:verify -- --workspace examples/product-workspace --migrations examples/product-database --cases docs/AI_WORKSPACE_CASES.json
```

Controller·Service·SQL 세 파일의 해시는 mini·Express 실행 전후와 이전 1.0.6 수정본에서 동일했다. 외부 workspace/migration 디렉터리로 옮겨 실행했으며 호스트별 소스 치환은 없었다.

## 용량·메모리 해석

최소 Starter는 약 0.16 MiB의 소스 ZIP으로, 기존 첨부 약 17 MB급 ZIP의 Vue·정적 콘솔·역사 자료·장치/게시 도구를 제거했다. 실제 최종 ZIP의 바이트 수·파일 수·감소율은 별도 `ARTIFACT_SIZES_1.0.7.json`을 기준으로 한다. Node 실행 파일과 npm 설치 결과는 ZIP 크기에 포함되지 않는다. 설치된 esbuild-wasm의 관측 디스크 점유는 약 13.9 MiB였다.

공통 런타임을 그대로 사용한 캐시 없는 Product 기동에서 서버 RSS는 준비 직후 303 MiB, 약 1초·2초 후 204 MiB였다. 기존 런타임이 500 ms 유휴 컴파일 작업자를 종료해도 프로세스 RSS가 즉시 최소치로 내려가지는 않았다.

이를 줄이기 위해 `workspace:verify`는 별도 프로세스에서 Controller·Service 및 공통 Controller를 임시 캐시에 컴파일하고, 그 프로세스가 끝난 뒤 API 서버를 시작한다. loader·decorator·DB·응답 계약이나 컴파일러 버전은 바꾸지 않았다. 사용자 workspace의 임의 테스트·템플릿 파일은 사전 컴파일 대상으로 넓히지 않는다.

최종 검증기에서 Product 10개 사례를 실행한 결과 API 서버 RSS는 **70 MiB**, 별도 컴파일 프로세스의 관측 최대 RSS는 **264,412 KiB(약 258.2 MiB)**였다. 컴파일 634 ms, 서버 준비 249 ms가 관측됐다. 이는 한 번의 측정이며 처리 시간 보장이나 전체 실행 최고 메모리 측정이 아니다. 범용 검증기의 해당 변경 후 테스트 3/3과 Product 사례 10/10을 다시 통과했다. 새로 추출·설치한 최소 Starter에서도 서버 RSS 70 MiB와 Product 10/10을 확인했고, 해당 실행의 컴파일 프로세스 최대 RSS는 250,444 KiB(약 244.6 MiB)였다. 분리 기동 실험에서는 서버 준비 직후·약 1초·2초에 각각 70 MiB가 관측됐다.

RSS 수치는 해당 서버 프로세스의 관측값이며 검증기 부모 프로세스와 OS 전체 사용량을 포함하지 않는다. 컴파일 단계의 순간 메모리 요구량은 별도로 남는다. 일반 `npm start`를 저메모리 모드로 변경한 것은 아니며, 새 동적 helper의 cache miss가 발생하면 런타임 컴파일이 추가될 수 있다. 모든 환경에서 같은 수치나 고정 메모리 상한을 보장하지 않는다.

## 패키지·패치 검증과 증거

최종 패키지 검증기는 ZIP 무결성·안전한 경로·명시적 파일 목록과 SHA-256, Full/Starter 공통 런타임·업무 파일 일치, 외부 RULES와 내장 문서 일치를 검사한다. 두 패치를 각각 첨부 원본의 복사본에 적용해 결과 소스가 해당 Full/Starter ZIP과 일치하는지 확인한다. dry-run 무변경, 사용자 소스 충돌 시 전체 적용 거절, 원본 백업, 기존 .env·DB·업로드 보존과 재적용 거절도 검사한다. 결과는 별도 `PACKAGE_VERIFICATION_1.0.7.json`에 기록한다.

원시 로그와 메모리 재현 스크립트는 `aidot-mini-v1.0.7-verification.zip`으로 제공한다. Full의 일부 과거 문서·슬라이드 및 클라이언트 안의 1.0.6 증거는 역사 자료이며 이번 검증 결과로 재계산하지 않는다.

이번에 다시 실행하지 않은 범위: Windows, Android·ROS 실기기, 실제 MariaDB, 원격 GitHub 게시, 브라우저 E2E 재실행. Vue 업무 소스와 서버 핵심 런타임은 이전 1.0.6에서 검증한 코드를 유지했으며 이번에는 설치·빌드·단위·HTTP·패키징 변경을 검증했다. 원격 PC 연결 없이 위 검증을 완료했다.
