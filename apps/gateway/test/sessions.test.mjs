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
