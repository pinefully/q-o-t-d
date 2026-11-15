// Validate questions.json. Run before committing (and later, before every deploy).
// Usage: node scripts/check-questions.mjs
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const errors = [];
let questions;

try {
  questions = JSON.parse(readFileSync(new URL("../questions.json", import.meta.url), "utf8"));
} catch (e) {
  console.error(`questions.json is not valid JSON: ${e.message}`);
  process.exit(1);
}

const ids = new Set();
const texts = new Set();
for (const q of questions) {
  const label = `#${q.id ?? "?"}`;
  if (!Number.isInteger(q.id) || q.id < 1) errors.push(`${label}: id must be a positive whole number`);
  if (ids.has(q.id)) errors.push(`${label}: duplicate id`);
  ids.add(q.id);

  if (typeof q.text !== "string" || !q.text.trim()) errors.push(`${label}: text is empty`);
  else if (texts.has(q.text.toLowerCase())) errors.push(`${label}: duplicate text`);
  else texts.add(q.text.toLowerCase());

  if ("retired" in q && typeof q.retired !== "boolean") errors.push(`${label}: retired must be true or false`);
}

// IDs are permanent: chats remember which IDs they've been asked.
// Deleting an ID breaks that history, so retire questions instead.
try {
  const committed = JSON.parse(execSync("git show HEAD:questions.json", { stdio: ["ignore", "pipe", "ignore"] }));
  for (const q of committed) {
    if (!ids.has(q.id)) errors.push(`#${q.id}: was deleted. Set "retired": true instead of removing it`);
  }
} catch {
  // No committed version yet; nothing to compare against.
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
const active = questions.filter((q) => !q.retired).length;
console.log(`OK: ${questions.length} questions (${active} active)`);
