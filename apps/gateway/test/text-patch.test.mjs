import assert from "node:assert/strict";
import test from "node:test";
import { applyUniqueTextPatch } from "../src/text-patch.mjs";

test("a focused text patch changes exactly one matching block", () => {
  assert.equal(applyUniqueTextPatch("const mode = 'old';\n", "'old'", "'new'"), "const mode = 'new';\n");
});

test("a patch refuses missing or ambiguous text", () => {
  assert.throws(() => applyUniqueTextPatch("one", "two", "new"), /not found/);
  assert.throws(() => applyUniqueTextPatch("one one", "one", "new"), /more than once/);
});
