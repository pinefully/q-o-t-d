// Thin wrapper around the Telegram Bot API.
// Every method is a POST to https://api.telegram.org/bot<TOKEN>/<method>.

export class TelegramError extends Error {
  constructor(method, status, description) {
    super(`${method} failed (${status}): ${description}`);
    this.status = status;
  }
}

export async function callTelegram(env, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new TelegramError(method, res.status, data.description);
  return data.result;
}

export const sendMessage = (env, chatId, text, extra = {}) =>
  callTelegram(env, "sendMessage", { chat_id: chatId, text, ...extra });
