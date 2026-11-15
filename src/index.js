// Conversation Cards: a Telegram bot that sends one question a day to each chat.
//
// Two entry points:
//   fetch()      Telegram POSTs every update (messages, button taps, bot added/removed) to /webhook
//   scheduled()  Cloudflare runs this at the top of every hour; it sends to chats due this hour
import { callTelegram, sendMessage, TelegramError } from "./telegram.js";
import { pickQuestion, recordAsked } from "./questions.js";

const log = (event, data = {}) => console.log(JSON.stringify({ event, ...data }));
const pad = (n) => String(n).padStart(2, "0");

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/webhook") {
      return new Response("Not found", { status: 404 });
    }
    if (!(await isFromTelegram(request, env))) {
      return new Response("Forbidden", { status: 403 });
    }

    try {
      await handleUpdate(await request.json(), env);
    } catch (err) {
      // Still return 200: a non-200 makes Telegram retry the same update repeatedly.
      log("update_error", { message: err.message });
    }
    return new Response("ok");
  },

  async scheduled(controller, env) {
    const now = new Date(controller.scheduledTime);
    const hour = now.getUTCHours();
    const today = now.toISOString().slice(0, 10);

    const { results } = await env.DB.prepare(
      `SELECT chat_id FROM chats
       WHERE active = 1 AND send_hour = ?
         AND (last_sent_date IS NULL OR last_sent_date != ?)`
    )
      .bind(hour, today)
      .all();

    let sent = 0;
    for (const { chat_id } of results) {
      try {
        await sendQuestion(env, chat_id, today);
        sent++;
      } catch (err) {
        await handleSendError(env, chat_id, err);
      }
    }
    log("daily_send", { hour, due: results.length, sent });
  },
};

// --- Security -------------------------------------------------------------

// When we register the webhook, we give Telegram a secret. Telegram sends it back
// in this header on every request, so anything without it isn't from Telegram.
async function isFromTelegram(request, env) {
  if (!env.WEBHOOK_SECRET) return false;
  const enc = new TextEncoder();
  const received = enc.encode(request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "");
  const expected = enc.encode(env.WEBHOOK_SECRET);
  if (received.byteLength !== expected.byteLength) return false;
  // Constant-time comparison, so response timing can't leak the secret.
  return crypto.subtle.timingSafeEqual(received, expected);
}

// --- Updates from Telegram ------------------------------------------------

async function handleUpdate(update, env) {
  if (update.my_chat_member) return handleMembership(update.my_chat_member, env);
  if (update.callback_query) return handleButton(update.callback_query, env);
  if (update.message) return handleMessage(update.message, env);
}

// Fired when the bot itself is added to, or removed from, a chat.
async function handleMembership({ chat, old_chat_member, new_chat_member }, env) {
  const wasIn = ["member", "administrator"].includes(old_chat_member.status);
  const isIn = ["member", "administrator"].includes(new_chat_member.status);

  if (isIn && !wasIn) {
    await activateChat(env, chat.id);
    await sendTimePicker(env, chat.id, true);
    log("chat_joined", { chat_id: chat.id, type: chat.type });
  } else if (!isIn && wasIn) {
    await env.DB.prepare("UPDATE chats SET active = 0 WHERE chat_id = ?").bind(chat.id).run();
    log("chat_left", { chat_id: chat.id });
  }
}

async function handleMessage(message, env) {
  const chatId = message.chat.id;

  // Groups get a new ID when Telegram upgrades them to a "supergroup".
  if (message.migrate_to_chat_id) {
    await migrateChat(env, chatId, message.migrate_to_chat_id);
    return;
  }

  // "/start@conversationcardsbot extra words" → "/start"
  const command = message.text?.startsWith("/")
    ? message.text.split(/\s/)[0].split("@")[0].toLowerCase()
    : null;

  switch (command) {
    case "/start":
    case "/time":
      await activateChat(env, chatId);
      await sendTimePicker(env, chatId, command === "/start");
      break;
    case "/stop":
      await env.DB.prepare("UPDATE chats SET active = 0 WHERE chat_id = ?").bind(chatId).run();
      await sendMessage(env, chatId, "Paused. No more daily questions until someone sends /start.");
      break;
    case "/help":
      await sendMessage(env, chatId, HELP_TEXT);
      break;
  }
}

// Fired when someone taps one of the hour buttons.
async function handleButton(query, env) {
  const chatId = query.message?.chat.id;
  const match = /^hour:(\d{1,2})$/.exec(query.data ?? "");
  if (!chatId || !match) return;

  const hour = Number(match[1]);
  const before = await env.DB.prepare("SELECT send_hour FROM chats WHERE chat_id = ?").bind(chatId).first();
  const isFirstSetup = before?.send_hour == null;

  await env.DB.prepare(
    `INSERT INTO chats (chat_id, send_hour) VALUES (?, ?)
     ON CONFLICT (chat_id) DO UPDATE SET send_hour = excluded.send_hour, active = 1`
  )
    .bind(chatId, hour)
    .run();

  await callTelegram(env, "answerCallbackQuery", { callback_query_id: query.id });
  await callTelegram(env, "editMessageText", {
    chat_id: chatId,
    message_id: query.message.message_id,
    text:
      `Set! A new question will arrive every day at ${pad(hour)}:00 UTC.\n\n` +
      `Change the time with /time, or pause with /stop.`,
  });
  log("time_set", { chat_id: chatId, hour, first: isFirstSetup });

  // Send the first question straight away, so the group sees how it works.
  if (isFirstSetup) {
    const today = new Date().toISOString().slice(0, 10);
    await sendQuestion(env, chatId, today);
  }
}

// --- Helpers --------------------------------------------------------------

async function sendQuestion(env, chatId, today) {
  const question = await pickQuestion(env.DB, chatId);
  await sendMessage(env, chatId, question.text);
  await recordAsked(env.DB, chatId, question.id, today);
}

function activateChat(env, chatId) {
  return env.DB.prepare(
    "INSERT INTO chats (chat_id) VALUES (?) ON CONFLICT (chat_id) DO UPDATE SET active = 1"
  )
    .bind(chatId)
    .run();
}

async function migrateChat(env, oldId, newId) {
  await env.DB.batch([
    env.DB.prepare("UPDATE chats SET chat_id = ? WHERE chat_id = ?").bind(newId, oldId),
    env.DB.prepare("UPDATE asked SET chat_id = ? WHERE chat_id = ?").bind(newId, oldId),
  ]);
  log("chat_migrated", { from: oldId, to: newId });
}

async function handleSendError(env, chatId, err) {
  // 403 = bot was removed or blocked; 400 "chat not found" = chat deleted.
  const gone =
    err instanceof TelegramError &&
    (err.status === 403 || /chat not found/i.test(err.message));
  if (gone) {
    await env.DB.prepare("UPDATE chats SET active = 0 WHERE chat_id = ?").bind(chatId).run();
  }
  log("send_failed", { chat_id: chatId, deactivated: gone, message: err.message });
}

function sendTimePicker(env, chatId, isWelcome) {
  const now = new Date();
  const intro = isWelcome
    ? "Hi! I'll drop one question into this chat every day: something to talk about, draw, or photograph together.\n\n"
    : "";

  // 24 buttons in rows of 4: 00:00 … 23:00
  const keyboard = [];
  for (let row = 0; row < 6; row++) {
    keyboard.push(
      [0, 1, 2, 3].map((col) => {
        const h = row * 4 + col;
        return { text: `${pad(h)}:00`, callback_data: `hour:${h}` };
      })
    );
  }

  return sendMessage(
    env,
    chatId,
    `${intro}What time should questions arrive? Times are in UTC. ` +
      `It's ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())} UTC right now.`,
    { reply_markup: { inline_keyboard: keyboard } }
  );
}

const HELP_TEXT = `I send one question a day for everyone here to answer.

/time – change when questions arrive
/stop – pause daily questions
/start – resume (or set up again)`;
