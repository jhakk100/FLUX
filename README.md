# Haru

Windows와 Linux에서 실행되는 로컬 우선 개인 AI 오케스트레이터의 P0 프로토타입입니다.

## 실행

Node.js 24 이상이 필요합니다.

```powershell
Copy-Item .env.example .env
node --env-file=.env apps/gateway/src/index.mjs
```

브라우저에서 `http://127.0.0.1:4317`을 여세요. 기본값은 외부 모델을 호출하지 않는 `demo` 모드입니다.

## Windows 실행 파일

Windows에서는 [dist/Haru.exe](./dist/Haru.exe)를 더블클릭해 실행할 수 있습니다. 실행 파일은 Node.js를 따로 설치하지 않아도 되며, 로컬 Gateway를 시작한 뒤 브라우저를 엽니다. 같은 폴더의 `.env.example`을 `.env`로 복사하면 Ollama 또는 OpenAI 호환 API 설정을 추가할 수 있습니다.

개발자가 실행 파일을 다시 만들려면 의존성을 설치한 뒤 아래 명령을 실행합니다.

```powershell
pnpm run build:win
```

비대화형 환경에서는 `CI=true`를 함께 지정해도 됩니다.

Node의 단일 실행 파일 기능은 아직 활성 개발 단계라 첫 실행 시 실험적 기능 경고가 표시될 수 있습니다. 이 실행 파일은 Windows 전용이며, Linux 배포본은 해당 OS에서 별도로 빌드해야 합니다.

Ollama를 쓰려면 `.env`에서 `HARU_PROVIDER=ollama`와 모델 이름을 설정합니다. OpenAI 호환 Responses API를 쓰려면 `HARU_PROVIDER=openai-compatible`, API 키, 모델을 설정합니다. API 키는 브라우저나 Git에 저장하지 않습니다.

## 현재 포함된 P0 뼈대

- SQLite 기반 세션/메시지/승인/감사 기록
- 로컬 웹 대시보드, 세션 생성·전환, 스트리밍 채팅
- demo / Ollama / OpenAI 호환 Responses API 어댑터
- 프로젝트 경로 경계와 파일 변경 승인 요청 API
- 삭제·덮어쓰기·외부 효과를 자동 실행하지 않는 승인 정책

자세한 방향은 [설계 문서](./02-product-and-architecture.md)를 참고하세요.
