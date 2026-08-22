# Discord 연결

FLUX는 Discord를 공개 봇으로 열지 않습니다. 봇 토큰과 함께 **허용 Discord 사용자 ID**를 하나 이상 설정해야만 메시지를 처리합니다. 봇·웹훅 메시지는 무시하므로 봇끼리 반복해서 답하는 루프도 차단합니다.

## 1. Discord Developer Portal에서 봇 만들기

1. [Discord Developer Portal](https://discord.com/developers/applications)에서 New Application을 만들고 **Bot** 메뉴에서 봇을 추가합니다.
2. Bot Token을 재설정/복사합니다. 이 값은 비밀번호와 같으므로 Git, 스크린샷, 채팅에 넣지 마세요.
3. **Privileged Gateway Intents**의 `Message Content Intent`를 켭니다. FLUX는 메시지 본문을 읽어야 합니다.
4. **OAuth2 → URL Generator**에서 `bot` 범위를 고르고, Bot Permissions에는 최소 `View Channels`, `Send Messages`, `Send Messages in Threads`, `Read Message History`를 선택해 서버에 초대합니다.

## 2. FLUX에 제한 목록과 토큰 넣기

`.env.example`을 `.env`로 복사한 뒤 아래를 채웁니다. Discord 앱의 개발자 모드에서 사용자나 채널을 우클릭해 **ID 복사**를 사용할 수 있습니다.

```dotenv
FLUX_DISCORD_BOT_TOKEN=여기에_토큰
FLUX_DISCORD_ALLOWED_USER_IDS=내_Discord_사용자_ID
# 선택: 지정하면 이 채널들에서만 응답합니다.
FLUX_DISCORD_ALLOWED_CHANNEL_IDS=허용할_채널_ID
```

실행 파일이나 Gateway를 다시 시작하면 연결합니다. `/api/discord/status`에서 토큰 유무, 허용 사용자·채널 수와 연결 상태를 확인할 수 있습니다. 토큰 값 자체는 어떤 API에도 반환하지 않습니다.

## 동작 방식

- 허용 채널을 지정하면 그 채널의 허용 사용자 메시지에 답합니다.
- 허용 채널을 비워 두면 DM 및 서버에서 봇을 멘션한 메시지에만 답합니다.
- Discord의 `채널 × 사용자`마다 별도 FLUX 세션을 이어가므로 문맥·압축 기록·장기 기억·모델 설정을 웹 채팅과 동일하게 사용합니다.
- Discord 한 메시지의 안전한 길이에 맞춰 긴 답변은 약 1,900자씩 나누어 보냅니다. 멘션을 포함한 자동 멘션은 허용하지 않습니다.
