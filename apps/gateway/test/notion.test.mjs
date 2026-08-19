import assert from "node:assert/strict";
import test from "node:test";
import { notionStatus, readNotionPage, searchNotion, testNotionConnection } from "../src/notion.mjs";

const notion = { apiKey: "secret", apiVersion: "2026-03-11" };

function fakeFetch(responses, requests) {
  return async (url, options) => {
    requests.push({ url, options });
    const next = responses.shift();
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200, headers: { "content-type": "application/json" } });
  };
}

test("Notion status does not expose the integration token", () => {
  const status = notionStatus(notion);
  assert.deepEqual(status, { configured: true, apiVersion: "2026-03-11", mode: "read-only" });
  assert.equal(JSON.stringify(status).includes("secret"), false);
});

test("Notion calls use a versioned bearer request and support search", async () => {
  const requests = [];
  const result = await searchNotion(notion, { query: "수업", cursor: "next" }, { fetchImpl: fakeFetch([{ body: { results: [] } }], requests) });
  assert.deepEqual(result, { results: [] });
  assert.equal(requests[0].url, "https://api.notion.com/v1/search");
  assert.equal(requests[0].options.headers["notion-version"], "2026-03-11");
  assert.equal(requests[0].options.headers.authorization, "Bearer secret");
  assert.deepEqual(JSON.parse(requests[0].options.body), { query: "수업", page_size: 50, start_cursor: "next" });
});

test("Notion page reads retrieve page metadata and first-level blocks together", async () => {
  const requests = [];
  const result = await readNotionPage(notion, "12345678-1234-1234-1234-123456789012", { fetchImpl: fakeFetch([{ body: { object: "page" } }, { body: { object: "list", results: [] } }], requests) });
  assert.equal(result.page.object, "page");
  assert.equal(result.blocks.object, "list");
  assert.equal(requests[0].url, "https://api.notion.com/v1/pages/12345678-1234-1234-1234-123456789012");
  assert.equal(requests[1].url, "https://api.notion.com/v1/blocks/12345678-1234-1234-1234-123456789012/children?page_size=100");
  await assert.rejects(() => readNotionPage(notion, "not-an-id"), /page ID/);
});

test("Notion connection test returns only identity metadata", async () => {
  const result = await testNotionConnection(notion, { fetchImpl: fakeFetch([{ body: { id: "bot-id", name: "Flux", type: "bot" } }], []) });
  assert.deepEqual(result, { ok: true, bot: { id: "bot-id", name: "Flux", type: "bot" } });
});
