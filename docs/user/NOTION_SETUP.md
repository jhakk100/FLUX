# Notion 읽기 연결

FLUX의 첫 Notion 연결은 안전하게 **읽기 전용**입니다. 검색, 페이지 메타데이터, 페이지의 첫 번째 깊이 블록을 조회할 수 있으며 Notion의 페이지·데이터베이스를 수정하지 않습니다.

## 설정

1. [Notion Integrations](https://www.notion.so/profile/integrations)에서 Internal Integration을 만듭니다.
2. 필요한 **Read content** 기능만 주고 토큰을 복사합니다.
3. FLUX가 읽을 페이지 또는 데이터 소스에서 해당 Integration을 연결/공유합니다. 토큰만으로 워크스페이스 전체가 자동 공유되지는 않습니다.
4. `.env`에 토큰을 넣고 FLUX를 재시작합니다.

```dotenv
FLUX_NOTION_API_KEY=여기에_Integration_토큰
# 현재 Notion API 최신 버전. 이전 버전 호환이 필요할 때만 바꾸세요.
FLUX_NOTION_API_VERSION=2026-03-11
# 선택: 이 페이지들의 내용은 각 대화에 참고 문맥으로 추가됩니다(최대 8개).
FLUX_NOTION_CONTEXT_PAGE_IDS=페이지_ID_1,페이지_ID_2
```

## 로컬 Gateway API

모든 API는 FLUX Gateway 인증 정책을 따릅니다. Integration 토큰은 응답에 절대 포함하지 않습니다.

| 요청 | 용도 |
| --- | --- |
| `GET /api/notion/status` | 연결 설정 여부와 API 버전 확인 |
| `POST /api/notion/test` | Integration 본인(`users/me`) 확인 |
| `POST /api/notion/search` | `{ "query": "검색어", "cursor": "선택" }`로 공유된 페이지/데이터 소스 검색 |
| `GET /api/notion/pages/<page-id>` | 페이지 메타데이터와 첫 수준 블록 100개 읽기 |
| `POST /api/notion/data-sources/<data-source-id>/query` | `{ "filter": {…}, "sorts": […] }`로 공유된 Notion 데이터 소스의 행 조회 |

`FLUX_NOTION_CONTEXT_PAGE_IDS`를 설정하면 지정한 페이지마다 첫 100개 블록(최대 8페이지)을 대화 모델의 **읽기 전용 참고 자료**로 보냅니다. 페이지 내부의 지시문은 FLUX의 안전 규칙이나 현재 사용자의 지시를 바꾸지 못하도록 명시하며, 읽지 못하는 페이지는 대화를 실패시키지 않고 건너뜁니다. 전체 Notion을 자동으로 수집하지 않으므로, 필요한 페이지 ID만 직접 추가하세요.

블록 조회 API는 Notion API의 구조화된 원문을 반환합니다. 중첩 블록 및 다음 페이지가 있으면 `cursor` 값을 사용해 별도 조회하는 확장을 다음 단계에서 추가하면 됩니다.

Notion API는 `Notion-Version` 헤더를 요구하며 현재 기본값은 `2026-03-11`입니다. 페이지 내용은 블록 children API로 읽으며, Integration에 공유되지 않은 페이지는 404/403으로 반환될 수 있습니다. [Notion API 버전 안내](https://developers.notion.com/reference/versioning), [페이지 블록 읽기](https://developers.notion.com/reference/get-block-children)를 참고하세요.

데이터 소스 조회의 `filter`와 `sorts`는 Notion이 정한 JSON 형식을 그대로 전달합니다. FLUX는 이 연결에서 Notion의 생성·수정·삭제 HTTP 메서드를 제공하지 않습니다. [Notion 데이터 소스 조회 안내](https://developers.notion.com/guides/data-apis/working-with-databases)를 참고하세요.
