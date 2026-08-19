import assert from "node:assert/strict";
import test from "node:test";
import { notionBlocksToText, notionStatus, queryNotionDataSource, readNotionPage, searchNotion, testNotionConnection } from "../src/notion.mjs";

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
  assert.deepEqual(status, { configured: true, apiVersion: "2026-03-11", mode: "read-only", contextPageCount: 0 });
  assert.equal(JSON.stringify(status).includes("secret"), false);
});

test("Notion blocks become bounded plain reference text", () => {
  const text = notionBlocksToText([
    { type: "heading_1", heading_1: { rich_text: [{ plain_text: "수업 메모" }] } },
    { type: "to_do", to_do: { checked: false, rich_text: [{ plain_text: "과제 제출" }] } },
    { type: "code", code: { rich_text: [{ plain_text: "const flux = true;" }] } },
  ]);
  assert.equal(text, "# 수업 메모\n- [ ] 과제 제출\n```\nconst flux = true;\n```");
  assert.equal(notionBlocksToText([{ type: "paragraph", paragraph: { rich_text: [{ plain_text: "0123456789" }] } }], 5), "… (Notion reference truncated)");
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

test("Notion data source queries remain read-only and pass filters through", async () => {
  const requests = [];
  const result = await queryNotionDataSource(notion, "12345678123412341234123456789012", { filter: { property: "Status", status: { equals: "진행" } }, sorts: [{ property: "날짜", direction: "descending" }] }, { fetchImpl: fakeFetch([{ body: { results: [{ id: "page" }] } }], requests) });
  assert.deepEqual(result, { results: [{ id: "page" }] });
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].url, "https://api.notion.com/v1/data_sources/12345678123412341234123456789012/query");
  assert.deepEqual(JSON.parse(requests[0].options.body), { page_size: 100, filter: { property: "Status", status: { equals: "진행" } }, sorts: [{ property: "날짜", direction: "descending" }] });
});
