# B2B 통합 KPI 대시보드

넷폼알앤디 B2B 팀의 통합 KPI 대시보드 소스 저장소입니다.

- **실제 서비스(데이터 조회):** Google Apps Script 웹앱 — https://script.google.com/macros/s/AKfycbxVUyuJxCDL3BcYJmLzEiOFieKn14kUQKKfcPxwm8qN5PUHLWiLQG5EKhLI9ghafmFjSw/exec
- **GitHub Pages:** 데이터가 없는 안내 화면입니다. [대시보드 열기]를 누르면 위 웹앱으로 이동하고, 거기서 구글 로그인과 열람 권한 검사를 거친 사람만 숫자를 봅니다.

## 왜 GitHub Pages에서 바로 데이터를 보여주지 않나요?

- 화면은 Apps Script 안에서만 쓸 수 있는 `google.script.run`으로 서버를 부릅니다. GitHub Pages(github.io)에서는 이 호출이 동작하지 않습니다.
- 다른 도메인에서 웹앱을 직접 부르면 구글 로그인 쿠키가 함께 전달되지 않습니다(CORS·제3자 쿠키 제한).
- 이를 우회하려면 웹앱을 누구나 부를 수 있는 공개 API로 바꾸거나 JSONP·iframe 허용을 열어야 합니다. 그러면 보안이 약해지므로 하지 않았습니다.
- 그래서 **데이터 조회·계산·권한 검사는 계속 Apps Script 서버에서만** 합니다. 이 저장소에는 화면과 서버 소스만 있고, 데이터는 없습니다.

## 구조

| 경로 | 내용 |
|---|---|
| `src/analyze.js` | KPI 계산(서버에서 실행). 통합시트 탭을 읽어 집계 JSON을 만듭니다. |
| `src/server.gs` | 웹앱 서버: 권한 확인, 캐시, 원본 행 조회, 행 수 점검. 시트 ID는 `__SHEET_ID__` 자리표시자입니다. |
| `src/ui.template.html` | 화면(7개 메뉴, 설명 팝업, 검색·필터·상세보기). 데이터는 들어 있지 않습니다. |
| `src/appsscript.json` | 웹앱 설정: 접속한 사용자 권한으로 실행, 시트 읽기 전용 범위. |
| `index.html` | GitHub Pages 안내 화면(위 화면을 웹앱 주소로 채운 것). 데이터 없음. |
| `tools/build.cjs` | `config.local.json`(저장소 밖)을 읽어 `dist/`에 Apps Script 배포 파일을 만듭니다. |
| `tools/build-ext.cjs` | 로컬 엑셀(잔디 영업활동·PT 등)을 서버 내장 자료로 묶습니다. 결과는 `private/`(저장소 제외). |

## 보안 원칙

- 이 저장소에는 **구글시트 데이터, 매출 원장, 거래처별 금액, 사업자번호, 연락처, 인증키, 시트 ID**를 넣지 않습니다. `.gitignore`가 `config.local.json`, `dist/`, `private/`, 엑셀·CSV·내장 자료(`*.b64`)를 막습니다.
- 숫자는 웹앱에서만, **접속한 사람 본인의 구글 계정 권한**으로 시트를 읽을 수 있을 때만 내려갑니다. GitHub 주소를 알아도 내부 숫자는 볼 수 없습니다.
- 서버는 응답에 사업자번호 형식이 섞이면 표시를 중단하고, 원본 조회 화면에서도 사업자번호를 가립니다.

## 배포 순서(Apps Script)

1. `config.example.json`을 복사해 `config.local.json`을 만들고 시트 ID·웹앱 주소·비공개 자료 경로를 채웁니다.
2. `node tools/build.cjs` → `dist/Code.gs`, `dist/index.html`, `dist/appsscript.json` 생성.
3. Apps Script 프로젝트에 붙여넣고 저장 → [배포 관리 → 수정 → 새 버전]. 웹앱 주소는 그대로 유지됩니다.
4. 되돌리기: [배포 관리]에서 이전 버전을 고릅니다.

통합시트 원천 동기화(30분)는 통합시트에 연결된 **별도 Apps Script 프로젝트**에 있으며, 이 저장소와 무관합니다.

## 앞으로 연결할 자리(이번에는 연결하지 않음)

| 시스템 | 가져올 자료 | 연결 위치(안) | 주의 |
|---|---|---|---|
| 이카운트 OPEN API | 신규 판매(매출·주요 자재) | 통합시트 동기화 프로젝트에 시간 트리거 → `01_ERP최신원장` 형식의 새 탭에 추가 → `analyze.js`는 지금처럼 원장 탭만 합산 | API 인증키는 Script Properties에만 저장. 전표번호+행으로 중복 방지. 기존 원장과 겹치는 기간 처리 규칙 필요 |
| 고객관리카드(Firebase) | 업체 마스터·협약일·업체코드 | 동기화 프로젝트에서 서버 간 호출 → `동기화_카드` 탭 → 업체 마스터와 B2B 코드로 대조 후 승인된 것만 반영 | 카드 인증 정보는 서버에만. 이름만 같은 업체는 자동으로 합치지 않음 |

두 연동 모두 **서버(Apps Script)에서만** 가져오고, 브라우저나 이 저장소에는 키를 두지 않습니다.
