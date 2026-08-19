const NOTION_API_URL = "https://api.notion.com/v1";

function configured(notion) {
  return Boolean(notion.apiKey && notion.apiVersion);
}

export function notionStatus(notion) {
  return { configured: configured(notion), apiVersion: notion.apiVersion || null, mode: "read-only", contextPageCount: notion.contextPageIds?.length ?? 0 };
}

export function notionBlocksToText(blocks, limit = 24_000) {
  const lines = [];
  let length = 0;
  for (const block of blocks) {
    const content = block[block.type] ?? {};
    const text = (content.rich_text ?? content.text ?? []).map((part) => part.plain_text ?? part.text?.content ?? "").join("").trim()
      || content.caption?.map((part) => part.plain_text ?? "").join("").trim()
      || content.title?.trim()
      || "";
    if (!text) continue;
    const prefix = { bulleted_list_item: "- ", numbered_list_item: "1. ", to_do: content.checked ? "- [x] " : "- [ ] ", quote: "> ", code: "```\n", heading_1: "# ", heading_2: "## ", heading_3: "### " }[block.type] ?? "";
    const suffix = block.type === "code" ? "\n```" : "";
    const line = `${prefix}${text}${suffix}`;
    if (length + line.length + 1 > limit) {
      lines.push("… (Notion reference truncated)");
      break;
    }
    lines.push(line);
    length += line.length + 1;
  }
  return lines.join("\n");
}

async function notionRequest(notion, resource, { method = "GET", body, fetchImpl = fetch, signal = AbortSignal.timeout(10_000) } = {}) {
  if (!configured(notion)) {
    const error = new Error("Notion is not configured. Set FLUX_NOTION_API_KEY in .env and restart FLUX.");
    error.statusCode = 409;
    throw error;
  }
  const response = await fetchImpl(`${NOTION_API_URL}${resource}`, {
    method,
    headers: {
      authorization: `Bearer ${notion.apiKey}`,
      "notion-version": notion.apiVersion,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || `Notion request failed (${response.status}).`);
    error.statusCode = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw error;
  }
  return payload;
}

export async function testNotionConnection(notion, options) {
  const user = await notionRequest(notion, "/users/me", options);
  return { ok: true, bot: { id: user.id, name: user.name ?? null, type: user.type ?? null } };
}

export async function searchNotion(notion, { query = "", cursor = null } = {}, options) {
  const trimmed = query.trim();
  if (trimmed.length > 500) throw new Error("Notion search query must be at most 500 characters.");
  return notionRequest(notion, "/search", {
    method: "POST",
    body: { query: trimmed || undefined, page_size: 50, ...(cursor ? { start_cursor: cursor } : {}) },
    ...options,
  });
}

function cleanPageId(pageId) {
  const id = pageId.trim();
  if (!/^[0-9a-f]{32}$|^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    const error = new Error("Notion page ID must be a 32-character ID or UUID.");
    error.statusCode = 400;
    throw error;
  }
  return id;
}

export async function readNotionPage(notion, pageId, { cursor = null, fetchImpl = fetch } = {}) {
  const id = cleanPageId(pageId);
  const query = new URLSearchParams({ page_size: "100" });
  if (cursor) query.set("start_cursor", cursor);
  const [page, blocks] = await Promise.all([
    notionRequest(notion, `/pages/${id}`, { fetchImpl }),
    notionRequest(notion, `/blocks/${id}/children?${query}`, { fetchImpl }),
  ]);
  return { page, blocks };
}
