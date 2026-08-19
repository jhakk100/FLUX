# FLUX

> Fixing Lousy User eXperience

Windows와 Linux에서 실행되는 로컬 우선 개인 AI 오케스트레이터의 P0 프로토타입입니다.

개발용 Node.js·pnpm 설치와 설치 파일 보관 절차는 [개발 환경 설치 안내](./setup/README.md)에 있습니다.

## 실행

Node.js 24 이상이 필요합니다.

```powershell
Copy-Item .env.example .env
node --env-file=.env apps/gateway/src/index.mjs
```

브라우저에서 `http://127.0.0.1:4317`을 여세요. 기본값은 외부 모델을 호출하지 않는 `demo` 모드입니다.

## Windows 실행 파일

Windows에서는 [dist/Flux.exe](./dist/Flux.exe)를 더블클릭해 실행할 수 있습니다. 실행 파일은 Node.js를 따로 설치하지 않아도 되며, 로컬 Gateway를 시작한 뒤 브라우저를 엽니다. 같은 폴더의 `.env.example`을 `.env`로 복사하면 Ollama 또는 OpenAI 호환 API 설정을 추가할 수 있습니다.

개발자가 실행 파일을 다시 만들려면 의존성을 설치한 뒤 아래 명령을 실행합니다.

```powershell
pnpm run build:win
```

비대화형 환경에서는 `CI=true`를 함께 지정해도 됩니다.

Node의 단일 실행 파일 기능은 아직 활성 개발 단계라 첫 실행 시 실험적 기능 경고가 표시될 수 있습니다. 이 실행 파일은 Windows 전용이며, Linux 배포본은 해당 OS에서 별도로 빌드해야 합니다.

Ollama를 쓰려면 `.env`에서 `FLUX_PROVIDER=ollama`와 모델 이름을 설정합니다. OpenAI 호환 Responses API를 쓰려면 `FLUX_PROVIDER=openai-compatible`, API 키, 모델을 설정합니다. API 키는 Git에 저장하지 않으며, 대시보드로 저장한 키의 현재 로컬 보관 방식은 [API 연결 안내](./docs/API_SETUP.md)에 명시합니다.

API 설정 화면과 공급자별 복붙 예시는 [API 연결 안내](./docs/API_SETUP.md)에 있습니다.

## 프로젝트 지침

대시보드에서 새 대화를 만들 때 프로젝트를 선택하면, 그 프로젝트 루트의 `AGENTS.md`를 자동으로 대화 문맥에 넣습니다. `AGENTS.md`가 없으면 `FLUX.md`를 사용합니다. 파일은 최대 64 KiB의 일반 텍스트만 읽으며, 지침 파일의 내용은 FLUX의 승인·보안 규칙을 바꿀 수 없습니다.

## 대화 컨텍스트

FLUX는 기본적으로 추정 24,000 토큰의 75%에서 오래된 대화를 압축 기록으로 바꾸고 최근 12개 메시지는 원문으로 유지합니다. `FLUX_CONTEXT_TOKEN_BUDGET`, `FLUX_CONTEXT_COMPACT_THRESHOLD`로 조정할 수 있으며, 세션별 예상 사용량·압축 기록·태그는 `GET /api/sessions/<id>/context`에서 조회합니다.

## 현재 포함된 P0 뼈대

- SQLite 기반 세션/메시지/승인/감사 기록과 대화 검색·보관
- 사용자가 직접 관리하는 장기 기억과 관련 기억의 대화 문맥 반영
- 웹/Discord에 공통 적용하는 사용자 설정 말투·행동 지침
- 로컬 웹 대시보드, 세션 생성·전환, 기본 Markdown·코드 복사, 스트리밍 채팅·생성 중지
- demo / Ollama / OpenAI 호환 Responses API 어댑터
- 선택한 사용자·채널만 받는 Discord 봇 연동(봇/웹훅 루프 차단, 채널×사용자별 세션)
- Notion Integration의 읽기 전용 검색·페이지/블록 조회
- 프로젝트 폴더 탐색·이름 검색·텍스트 파일 읽기와 변경 전후 diff 승인 요청
- 프로젝트별 `AGENTS.md` 또는 `FLUX.md` 지침을 대화에 자동 반영
- 삭제·덮어쓰기·외부 효과를 자동 실행하지 않는 승인 정책

자세한 방향은 [설계 문서](./02-product-and-architecture.md)를 참고하세요.

Discord 봇 연결은 [Discord 연결 안내](./docs/DISCORD_SETUP.md)를 참고하세요.

Notion 연결은 [Notion 읽기 연결 안내](./docs/NOTION_SETUP.md)를 참고하세요.
