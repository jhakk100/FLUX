# FLUX API 연결 안내

FLUX에서는 **대시보드의 `AI API 설정` 버튼**으로 연결하는 방법을 권장합니다. 공급자, 서버 주소, 모델 이름, API 키를 입력하고 `저장` → `연결 시험` 순서로 진행하면 됩니다.

## API 키 보관 방식

- API 키는 대시보드에서 다시 표시하지 않습니다.
- 대시보드에서 저장한 값은 현재 PC의 `data/flux.sqlite`에만 저장됩니다. `data/`와 `.env`는 Git 추적에서 제외됩니다.
- 현재 P0은 OS 키체인 암호화를 아직 구현하지 않았습니다. 여러 사람이 쓰는 PC에서는 `.env`와 `data/` 폴더의 파일 접근 권한을 제한하세요.
- 대시보드 저장값이 있으면 환경 변수나 `.env` 파일보다 우선합니다. 키를 완전히 지우려면 설정 화면에서 **저장된 API 키를 지우기**를 선택합니다.

## 1. OpenAI 공식 API — 권장

설정 화면에서 **OpenAI 호환 Responses API**를 고릅니다.

| 항목 | 값 |
| --- | --- |
| 서버 주소 | `https://api.openai.com/v1` |
| 모델 예시 | `gpt-5.6-terra` |
| API 키 | OpenAI Platform에서 만든 API 키 |

FLUX는 이 방식에서 `POST /v1/responses`와 스트리밍 응답을 사용합니다. OpenAI는 멀티턴·도구 사용 워크플로에 Responses API 사용을 안내합니다. [공식 모델 가이드](https://developers.openai.com/api/docs/guides/latest-model)

ChatGPT/Codex 구독 로그인과 API 사용량은 별개일 수 있으므로, 이 앱에는 Platform API 키를 입력하는 방식으로 시작합니다. 키는 절대 대화 메시지나 Git 커밋에 넣지 마세요.

## 2. 사설 API (대학교) — 조선대학교 FactChat 기준

대시보드에서 **조선대 FactChat Gateway**를 고르고 학교에서 발급받은 API 키를 입력합니다. 기본 주소는 `https://factchat-cloud.mindlogic.ai/v1/gateway`입니다. 연결 시험은 `/models/`에서 본인 조직에 허용된 모델 목록을 확인합니다. 목록의 `id`를 그대로 모델 이름에 입력하세요.

- Claude·Gemini·일반 GPT 계열은 Chat Completions 경로를 사용합니다.
- Codex 계열은 FactChat의 Responses API 전용이므로, 대시보드에서 `조선대 FactChat Gateway (Responses/Codex)`를 선택합니다.
- API 키는 `Authorization: Bearer` 형식으로 전송되며, HTTPS 연결만 사용합니다.

공식 학교 Gateway 문서의 모델 허용 범위는 조직별로 달라질 수 있습니다. [Gateway 개요](https://docs.mindlogic.ai/docs/chosun-ac/api-gateway/getting-started/overview#api-gateway)

FLUX에서 `사설 API (대학교)`의 기준 구현은 이 Gateway입니다. 다른 대학 API도 동일한 Gateway 계약(모델 목록, Bearer 인증, Chat Completions)을 제공할 때만 이 공급자로 연결하세요. 문서 확인 없이 학교별 전용 주소나 요청 형식을 추측해 추가하지 않습니다.

FLUX의 `GET /api/provider-account`는 선택된 학교 API 키로 Gateway의 `/models/`와 `/credits/`를 함께 조회합니다. 결과에는 조직에 허용된 모델 ID와 월별 할당·사용·잔여 크레딧·다음 갱신일이 포함됩니다.

## 3. Ollama — 로컬 모델

설정 화면에서 **Ollama**를 고릅니다.

| 항목 | 값 |
| --- | --- |
| 서버 주소 | `http://127.0.0.1:11434` |
| 모델 이름 | Ollama에 설치된 정확한 모델 태그 |
| API 키 | 필요 없음 |

연결 시험은 Ollama 서버가 켜져 있는지와 설정한 모델이 목록에 있는지를 확인합니다. PDF·이미지 처리가 필요하면 비전/멀티모달 지원 모델을 설치해 모델 이름에 입력하세요.

FLUX의 대화 압축 기준과 Ollama의 실제 문맥 창은 별개입니다. AI API 설정의 **Ollama에 요청할 문맥 길이** 또는 `.env`의 `FLUX_OLLAMA_CONTEXT_LENGTH`를 설정하면 FLUX는 각 `/api/chat` 요청에 `options.num_ctx`를 넣습니다. 값이 클수록 GPU/RAM 사용량이 늘어날 수 있으므로 모델·PC 사양에 맞춰 정하세요. LM Studio 등 OpenAI 호환 서버는 표준 Chat Completions 요청에 이 설정이 없으므로 서버별 설정 화면에서 따로 문맥 길이를 지정해야 합니다. [Ollama 문맥 길이 안내](https://docs.ollama.com/faq)

## 4. LM Studio — 로컬 모델

LM Studio에서 **Developer → Local Server**를 시작한 뒤, 대시보드에서 **LM Studio — 내 PC의 로컬 모델**을 고릅니다.

| 항목 | 값 |
| --- | --- |
| 서버 주소 | `http://127.0.0.1:1234/v1` |
| 모델 이름 | Local Server에 불러온 모델의 ID |
| API 키 | LM Studio에서 인증을 켠 경우에만 입력 |

FLUX는 LM Studio의 OpenAI 호환 `POST /v1/chat/completions`를 사용합니다. 문맥 길이는 LM Studio 서버/모델 설정에서 정합니다.

## 5. 사설 API (일반) — Chat Completions 호환 서버

제공처의 문서에서 다음 중 어느 경로를 지원하는지 먼저 확인하세요.

| 지원 경로 | FLUX에서 고를 공급자 |
| --- | --- |
| `POST /v1/responses` | OpenAI 호환 Responses API |
| `POST /v1/chat/completions` | OpenAI 호환 Chat Completions API |

두 방식 모두 현재 연결 시험은 `GET /v1/models`를 시도합니다. 이 경로가 없는 서버는 시험이 실패할 수 있지만, 해당 제공처가 위 대화 경로를 지원한다면 실제 채팅으로도 확인할 수 있습니다. 이 경우 오류 내용을 복사해 보내주면 제공처에 맞는 어댑터를 추가하겠습니다.

## `.env`로 설정하는 방법

대시보드보다 파일 설정을 선호하면 [`.env.example`](../.env.example)을 `.env`로 복사하고 주석의 안내에 따라 한 공급자 블록만 활성화하세요.

```powershell
Copy-Item .env.example .env
notepad .env
.\dist\Flux.exe
```

설정이 바뀌면 FLUX를 완전히 종료한 뒤 다시 시작하세요. `.env` 파일과 `data/` 폴더는 절대 공개 저장소에 올리지 마세요.
