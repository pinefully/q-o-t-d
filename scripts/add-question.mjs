// Append one or more questions to questions.json with the next free ID.
// Usage: node scripts/add-question.mjs "First question?" "Second question?"
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../questions.json", import.meta.url);
const texts = process.argv.slice(2).map((t) => t.trim()).filter(Boolean);

if (texts.length === 0) {
  console.error('Usage: node scripts/add-question.mjs "Your question?"');
  process.exit(1);
}

const questions = JSON.parse(readFileSync(FILE, "utf8"));
const existing = new Set(questions.map((q) => q.text.toLowerCase()));
let nextId = Math.max(0, ...questions.map((q) => q.id)) + 1;

for (const text of texts) {
  if (existing.has(text.toLowerCase())) {
    console.warn(`Skipped (already exists): ${text}`);
    continue;
  }
  questions.push({ id: nextId, text });
  existing.add(text.toLowerCase());
  console.log(`Added #${nextId}: ${text}`);
  nextId++;
}

// One question per line keeps git diffs readable.
const body = questions.map((q) => "  " + JSON.stringify(q)).join(",\n");
writeFileSync(FILE, `[\n${body}\n]\n`);
