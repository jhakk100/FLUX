import assert from "node:assert/strict";
import test from "node:test";
import { selectProjectChildSessions } from "../src/project-child-sessions.mjs";

test("project leader distributes only to its own child conversations", () => {
  const sessions = [
    { id: "lead-a", projectId: "a", projectLead: true },
    { id: "child-a-1", projectId: "a", projectLead: false },
    { id: "child-b-1", projectId: "b", projectLead: false },
    { id: "child-a-2", projectId: "a", projectLead: false },
    { id: "lead-b", projectId: "b", projectLead: true },
  ];
  assert.deepEqual(selectProjectChildSessions(sessions, "a").map((session) => session.id), ["child-a-1", "child-a-2"]);
  assert.deepEqual(selectProjectChildSessions(sessions, "b").map((session) => session.id), ["child-b-1"]);
});

test("project leader never distributes to more than four children", () => {
  const sessions = Array.from({ length: 6 }, (_, index) => ({ id: `child-${index}`, projectId: "a", projectLead: false }));
  assert.equal(selectProjectChildSessions(sessions, "a").length, 4);
});