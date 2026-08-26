# FLUX 0.3.0

> Fixing Lousy User eXperience

Windows와 Linux에서 실행되는 로컬 우선 개인 AI 오케스트레이터입니다.
개발자의 코딩 실력이 형편없어, 아이디어와 약간의 지식을 바탕으로 Codex 같은 도구의 도움을 받아 만든 제품입니다. 따라서 하자가 있을 수 있습니다.


## 실행

소스 코드를 직접 실행하는 개발자에게는 Node.js 24 이상이 필요합니다.

```powershell
Copy-Item .env.example .env
node --env-file=.env apps/gateway/src/index.mjs
```
개발자는 Node.js 24 이상을 설치해 소스 코드를 직접 실행하거나 실행 파일을 다시 빌드할 수 있습니다. 현재 Linux 환경에서 소스로 실행하려면 Node.js가 필요합니다.

브라우저에서 `http://127.0.0.1:4317`을 여세요. 기본값은 외부 모델을 호출하지 않는 `demo` 모드입니다.

## Windows 실행 파일

Windows에서는 [dist/Flux.exe](./dist/Flux.exe)를 더블클릭해 실행할 수 있습니다. 실행 파일은 Node.js를 따로 설치하지 않아도 되며, 로컬 Gateway를 시작한 뒤 브라우저를 엽니다. 같은 폴더의 `.env.example`을 `.env`로 복사하면 Ollama 또는 OpenAI 호환 API 설정을 추가할 수 있습니다. 대화·설정 데이터는 FLUX 폴더 안의 `user-data`에 저장됩니다. FLUX 폴더 전체를 복사하면 이전 대화·프로젝트·API 설정도 함께 이동하며, 처음 실행할 때 기존 `dist/data` 또는 이전 사용자 저장소의 데이터는 자동으로 옮겨옵니다.

## CLI

패키지 실행 파일을 처음 직접 실행하면 Windows에서는 사용자 PATH에, Linux에서는 `~/.local/bin/flux`에 `flux` 명령을 한 번 자동 등록하려고 시도합니다. 새 PowerShell·명령 프롬프트를 연 뒤 사용하세요. 자동 등록에 실패한 경우 **설정 → CLI 명령 → flux PATH 등록** 버튼 또는 `Flux.exe --install-cli`/`flux install`로 다시 시도할 수 있습니다. 실행하면 빨간 `FU` 배너가 표시됩니다.

```powershell
flux --help
flux -chat "안녕"
flux chat --project "F:\my-project"
flux status
flux api models    # 선택된 LLM API의 사용 가능한 모델 조회
flux api refresh   # 모델 목록을 API에서 강제로 다시 조회
flux api services  # Discord·Notion 등 부가 서비스 API 상태
# PATH를 수동으로 등록할 때
.\dist\Flux.exe --install-cli
# 개발 환경
pnpm cli -- chat --message "안녕"
```

이전 실행 파일이 `dist/data`에 저장한 `flux.sqlite`는 새 영구 저장 위치가 비어 있을 때 첫 실행 시 복사합니다. 이후 실행 파일을 다시 빌드해도 새 저장 위치의 데이터는 삭제되지 않습니다.

개발자가 실행 파일을 다시 만들려면 의존성을 설치한 뒤 아래 명령을 실행합니다.

```powershell
# 권장: 빌드 후 고아 Node 프로세스까지 자동 검사
pnpm run build:verified
# 빌드만 실행
pnpm run build:win
# 필요할 때 고아 빌드 프로세스만 별도 검사
pnpm run check:build-processes
```

비대화형 환경에서는 `CI=true`를 함께 지정해도 됩니다.

Node의 단일 실행 파일 기능은 아직 활성 개발 단계라 첫 실행 시 실험적 기능 경고가 표시될 수 있습니다. 이 실행 파일은 Windows 전용이며, Linux 배포본은 해당 OS에서 별도로 빌드해야 합니다.

Ollama를 쓰려면 `.env`에서 `FLUX_PROVIDER=ollama`와 모델 이름을 설정합니다. OpenAI 호환 Responses API를 쓰려면 `FLUX_PROVIDER=openai-compatible`, API 키, 모델을 설정합니다. API 키는 Git에 저장하지 않으며, 대시보드로 저장한 키의 현재 로컬 보관 방식은 [API 연결 안내](./docs/user/API_SETUP.md)에 명시합니다.

API 설정 화면과 공급자별 복붙 예시는 [API 연결 안내](./docs/user/API_SETUP.md)에 있습니다.

## 프로젝트 지침

대시보드에서 프로젝트를 만들거나 **설정 → 프로젝트 지침**에서 수정한 지침은 해당 FLUX 프로젝트에만 저장되어, 그 프로젝트 대화에만 문맥으로 전달됩니다. 작업 폴더가 같아도 프로젝트별 지침은 서로 공유되지 않습니다. 지침은 FLUX의 승인·보안 규칙을 바꿀 수 없습니다.

## 프로젝트 단체방

프로젝트는 사용자·superior·최대 4명의 역할별 모델이 하나의 대화방에서 순서대로 검토하는 구조입니다. superior의 API·모델, 멤버별 역할·순서·시간, 0~50회 협업 라운드와 빈 응답 자동 재시도 횟수를 프로젝트마다 설정할 수 있습니다. 라운드 0은 실험적인 종료 판단 모드이며, 종료 표식이 없으면 50라운드에서 자동 비상 정지합니다. 사용법과 각 시간 설정의 뜻은 [프로젝트 단체방 안내](./docs/user/PROJECT_COLLABORATION.md)를 참고하세요.

## 대화 컨텍스트

FLUX는 기본적으로 추정 24,000 토큰의 75%에서 오래된 대화를 압축 기록으로 바꾸고 최근 12개 메시지는 원문으로 유지합니다. `FLUX_CONTEXT_TOKEN_BUDGET`, `FLUX_CONTEXT_COMPACT_THRESHOLD`로 조정할 수 있으며, 세션별 예상 사용량·압축 기록·태그는 `GET /api/sessions/<id>/context`에서 조회합니다.

## 파일 첨부

채팅 입력창의 `＋` 또는 드래그 앤 드롭으로 메시지당 최대 4개, 파일당 10 MB까지 첨부할 수 있습니다. 첨부 파일은 `user-data/attachments`에 대화 기록과 함께 보관됩니다. 이미지·텍스트 형식은 지원하는 Ollama, Gemini, OpenAI 호환 모델에 전달하며, 나머지 형식은 파일 이름·형식만 안전하게 알려 줍니다. 채팅에서는 이미지 미리보기, 오디오·영상 재생, 그 밖의 파일 다운로드를 지원합니다.
첨부 기능은 안정성을 검증하면서 지원 형식과 분석 품질을 계속 개선할 예정입니다.

## 현재 포함된 P0 뼈대

- SQLite 기반 세션/메시지/승인/감사 기록과 대화 검색·보관
- 사용자가 직접 관리하는 장기 기억·지속 목표와 관련 문맥 반영
- 웹/Discord에 공통 적용하는 사용자 설정 말투·행동 지침
- 로컬 웹 대시보드, 세션 생성·전환, Markdown 우선 응답·실시간 서식·코드 복사, 스트리밍 채팅·생성 중지·즉시 지시 자동 재시작·대화별 요청 제한
- API 키 저장 뒤 목록 팝업에서 모델을 선택하는 demo / Ollama / LM Studio / Google AI(Gemini) / OpenAI 호환 Responses API 어댑터
- 선택한 사용자·채널만 받는 Discord 봇 연동(봇/웹훅 루프 차단, 채널×사용자별 세션)
- Notion Integration의 읽기 전용 검색·페이지/블록 조회
- 프로젝트 폴더 구조와 대표 설정 파일을 모델 문맥에 읽기 전용으로 전달, 파일 탐색·이름 검색·텍스트 파일 읽기와 변경 전후 diff 승인 요청·적용된 변경 출처 기록
- FLUX 프로젝트별 독립 지침을 대화에 자동 반영
- 삭제·덮어쓰기·외부 효과를 자동 실행하지 않는 승인 정책 및 Windows/Linux 시스템 경로 프로젝트·변경 차단

자세한 방향은 [설계 문서](./docs/developer/PRODUCT_ARCHITECTURE.md)를 참고하세요.

Discord 봇 연결은 [Discord 연결 안내](./docs/user/DISCORD_SETUP.md)를 참고하세요.

Notion 연결은 [Notion 읽기 연결 안내](./docs/user/NOTION_SETUP.md)를 참고하세요.

> **주의:** Discord와 Notion 연결은 아직 충분히 검증되지 않아 불안정할 수 있습니다.

## 구현 예정

아래는 완료된 P0 기능과 별개로, 다음 업데이트에서 우선 검토·구현할 항목입니다. 전체 범위와 상태는 [선별 기능 목록](./docs/developer/SELECTED_SCOPE.md)에서 확인할 수 있습니다.

- [ ] ★★ **개인 작업 공간**: 외부 프로젝트·첨부·WebDAV/NAS와 분리된 안전한 작업 폴더, 가져오기·복사본 분석·명시적 내보내기
- [ ] **모델 운영 개선**: 모델별 추론 강도, 사용량·오류 현황, 장애 시 안전한 대체 모델 전환
- [ ] **기억·문맥 고도화**: 중요 정보 자동 추출, 정기 정리, 의미 기반 검색(RAG) 검토
- [ ] **안전한 PC 작업 확대**: 터미널·프로세스·코드 실행을 명시적 승인과 격리 정책 아래 제공
- [ ] **프로젝트 협업 보강**: 실행 중 특정 멤버에게 지시 전달, 더 명확한 협업·파일 출처 감사 기록
- [ ] **저장소·연동 확대**: WebDAV/NAS 권한 연결, Notion 외 유용한 서비스 연동
- [ ] **후순위 기능**: 웹 검색·브라우저 자동화, 일정·자동화, 음성·미디어, 플러그인/MCP, 원격 접속과 TUI

## 알려진 문제

현재 확인된 제한·외부 서비스 문제·우회 방법은 [알려진 문제](./docs/user/KNOWN_ISSUES.md)에 기록합니다.

## License

MIT © 2026 Baek JongHak. See [LICENSE](./LICENSE).
