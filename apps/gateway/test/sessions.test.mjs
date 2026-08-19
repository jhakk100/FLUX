import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openStore } from "../src/db.mjs";

test("sessions can be renamed, searched, archived, and restored", async (context) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "flux-sessions-"));
  context.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const store = openStore(dataDirectory);
  const session = store.createSession({ title: "초안" });
  store.addMessage({ sessionId: session.id, role: "user", content: "오로라 검색어" });

  assert.equal(store.renameSession(session.id, "새 이름").title, "새 이름");
  assert.equal(store.searchSessions("오로라").length, 1);
  assert.equal(store.archiveSession(session.id, true).archivedAt !== null, true);
  assert.equal(store.listSessions().length, 0);
  assert.equal(store.listSessions({ archived: true }).length, 1);
  assert.equal(store.archiveSession(session.id, false).archivedAt, null);
  store.close();
});

test("each Discord channel and user pair keeps an isolated reusable session", async (context) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "flux-discord-sessions-"));
  context.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const store = openStore(dataDirectory);
  const first = store.getOrCreateDiscordSession({ channelId: "channel-a", userId: "user-a", title: "Discord · a" });
  const again = store.getOrCreateDiscordSession({ channelId: "channel-a", userId: "user-a", title: "Discord · a" });
  const anotherUser = store.getOrCreateDiscordSession({ channelId: "channel-a", userId: "user-b", title: "Discord · b" });
  const anotherChannel = store.getOrCreateDiscordSession({ channelId: "channel-b", userId: "user-a", title: "Discord · a" });

  assert.equal(first.source, "discord");
  assert.equal(again.id, first.id);
  assert.notEqual(anotherUser.id, first.id);
  assert.notEqual(anotherChannel.id, first.id);
  store.close();
});
