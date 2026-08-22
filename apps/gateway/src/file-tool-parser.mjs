export function parseFileToolCalls(text) {
  // A response is actionable only when it consists entirely of FLUX tool blocks.
  // This keeps explanatory text from providers such as Gemini out of the file loop.
  const calls = [];
  let cursor = 0;
  while (cursor < text.length) {
    while (/\s/.test(text[cursor] ?? "")) cursor += 1;
    if (cursor >= text.length) break;
    if (text.slice(cursor, cursor + 11).toLowerCase() !== "<flux-tool>") return [];
    cursor += 11;
    while (/\s/.test(text[cursor] ?? "")) cursor += 1;
    if (text[cursor] !== "{") return [];
    const start = cursor;
    let depth = 0; let quoted = false; let escaped = false; let end = -1;
    for (; cursor < text.length; cursor += 1) {
      const character = text[cursor];
      if (quoted) { if (escaped) escaped = false; else if (character === "\\") escaped = true; else if (character === '"') quoted = false; continue; }
      if (character === '"') quoted = true;
      else if (character === "{") depth += 1;
      else if (character === "}" && --depth === 0) { end = cursor + 1; break; }
    }
    if (end < 0) return [];
    try {
      const call = JSON.parse(text.slice(start, end));
      if (!call || typeof call !== "object" || Array.isArray(call) || typeof call.action !== "string") return [];
      calls.push(call);
    } catch { return []; }
    cursor = end;
    while (/\s/.test(text[cursor] ?? "")) cursor += 1;
    if (text.slice(cursor, cursor + 12).toLowerCase() === "</flux-tool>") cursor += 12;
  }
  return calls;
}