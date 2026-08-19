const RECENT_MESSAGE_COUNT = 12;
const MAX_SUMMARY_CHARS = 12_000;

export function estimateTokens(text) {
  const value = String(text ?? "");
  const ascii = (value.match(/[\x00-\x7f]/g) ?? []).length;
  return Math.ceil(ascii / 4 + (value.length - ascii) / 2);
}

export function deriveTags(messages, existingTags = []) {
  const tags = new Set(existingTags.map((tag) => tag.toLocaleLowerCase()));
  for (const message of messages) {
    for (const match of message.content.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]{2,40})/gu)) tags.add(match[1].toLocaleLowerCase());
    if (/\b(?:error|오류|실패)\b/i.test(message.content)) tags.add("error");
    if (/\b(?:todo|할 일|해야)\b/i.test(message.content)) tags.add("todo");
    if (/\b(?:완료|done|finished)\b/i.test(message.content)) tags.add("done");
    if (/```/.test(message.content)) tags.add("code");
  }
  return [...tags].slice(0, 30);
}

export function compactContext(messages, previous = {}) {
  const coveredCount = previous.coveredCount ?? 0;
  const boundary = Math.max(coveredCount, messages.length - RECENT_MESSAGE_COUNT);
  const older = messages.slice(coveredCount, boundary);
  if (!older.length) return { ...previous, coveredCount, changed: false };
  const entries = older.map((message) => {
    const excerpt = message.content.replace(/\s+/g, " ").trim().slice(0, 360);
    return `- ${message.role}: ${excerpt}`;
  });
  const previousSummary = previous.summary ? `${previous.summary}\n` : "";
  const summary = `${previousSummary}## 자동 기록 (${older.length}개 메시지 압축)\n${entries.join("\n")}`.slice(-MAX_SUMMARY_CHARS);
  return {
    summary,
    coveredCount: boundary,
    tags: deriveTags(older, previous.tags ?? []),
    changed: true,
  };
}

export function buildModelContext(messages, context, tokenBudget, threshold) {
  const fullTokens = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
  const shouldCompact = fullTokens >= Math.floor(tokenBudget * threshold);
  const compacted = shouldCompact ? compactContext(messages, context) : { ...context, changed: false };
  const activeMessages = compacted.coveredCount ? messages.slice(compacted.coveredCount) : messages;
  const summaryMessage = compacted.summary ? { role: "system", content: `Compressed session record:\n${compacted.summary}` } : null;
  const activeTokens = activeMessages.reduce((sum, message) => sum + estimateTokens(message.content), 0) + estimateTokens(compacted.summary);
  return { fullTokens, activeTokens, context: compacted, summaryMessage, activeMessages, shouldCompact };
}
