export function applyUniqueTextPatch(source, find, replacement) {
  if (typeof find !== "string" || !find) throw new Error("Patch find text is required.");
  if (typeof replacement !== "string") throw new Error("Patch replacement text is required.");
  let matches = 0;
  let offset = 0;
  while (true) {
    const index = source.indexOf(find, offset);
    if (index < 0) break;
    matches += 1;
    offset = index + find.length;
  }
  if (matches === 0) throw new Error("Patch text was not found. Read the current file and try again.");
  if (matches > 1) throw new Error("Patch text occurs more than once. Include more surrounding text so the change is unambiguous.");
  return source.replace(find, replacement);
}
