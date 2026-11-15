// One-time setup (safe to re-run): uploads secrets to Cloudflare and points Telegram at the Worker.
// Usage: node scripts/setup-bot.mjs https://qotd-bot.<your-subdomain>.workers.dev
//
// Needs a .dev.vars file (gitignored) containing a line: BOT_TOKEN=<token from @BotFather>
// Never prints secret values.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const VARS_FILE = new URL("../.dev.vars", import.meta.url);
const workerUrl = process.argv[2]?.replace(/\/$/, "");
if (!workerUrl?.startsWith("https://")) {
  console.error("Usage: node scripts/setup-bot.mjs https://qotd-bot.<subdomain>.workers.dev");
  process.exit(1);
}

// 1. Read .dev.vars, creating WEBHOOK_SECRET if it isn't there yet.
if (!existsSync(VARS_FILE)) {
  console.error("Missing .dev.vars. Create it with one line: BOT_TOKEN=<your token>");
  process.exit(1);
}
const raw = readFileSync(VARS_FILE, "utf8");
const vars = Object.fromEntries(
  raw.split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);
if (!vars.BOT_TOKEN) {
  console.error("BOT_TOKEN not found in .dev.vars");
  process.exit(1);
}
if (!vars.WEBHOOK_SECRET) {
  vars.WEBHOOK_SECRET = randomBytes(32).toString("hex");
  writeFileSync(VARS_FILE, raw.trimEnd() + `\nWEBHOOK_SECRET=${vars.WEBHOOK_SECRET}\n`);
  console.log("✓ Generated WEBHOOK_SECRET and saved it to .dev.vars");
}

// 2. Upload both secrets to the Worker (value goes through stdin, not the command line).
for (const name of ["BOT_TOKEN", "WEBHOOK_SECRET"]) {
  const r = spawnSync("npx", ["wrangler", "secret", "put", name], {
    input: vars[name],
    stdio: ["pipe", "ignore", "inherit"],
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
  console.log(`✓ Uploaded ${name} to Cloudflare`);
}

// 3. Tell Telegram where to send updates, and which ones we care about.
async function tg(method, payload, attempt = 1) {
  let res;
  try {
    res = await fetch(`https://api.telegram.org/bot${vars.BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // Network blips (e.g. ECONNRESET): wait a moment and retry up to 3 times.
    if (attempt >= 3) throw err;
    console.log(`  ${method}: network error (${err.cause?.code ?? err.message}), retrying…`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
    return tg(method, payload, attempt + 1);
  }
  const data = await res.json();
  if (!data.ok) throw new Error(`${method}: ${data.description}`);
  return data.result;
}

await tg("setWebhook", {
  url: `${workerUrl}/webhook`,
  secret_token: vars.WEBHOOK_SECRET,
  allowed_updates: ["message", "callback_query", "my_chat_member"],
  drop_pending_updates: true,
});
console.log(`✓ Webhook set to ${workerUrl}/webhook`);

// 4. Commands shown in Telegram's "/" menu.
await tg("setMyCommands", {
  commands: [
    { command: "time", description: "Change when daily questions arrive" },
    { command: "stop", description: "Pause daily questions" },
    { command: "start", description: "Resume or set up again" },
    { command: "help", description: "How this bot works" },
  ],
});
console.log("✓ Command menu set");

const info = await tg("getWebhookInfo", {});
console.log(`  Pending updates: ${info.pending_update_count}${info.last_error_message ? `, last error: ${info.last_error_message}` : ""}`);
