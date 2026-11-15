-- One row per Telegram chat the bot has been added to.
CREATE TABLE chats (
  chat_id        INTEGER PRIMARY KEY,
  send_hour      INTEGER,                  -- 0–23 in UTC; NULL until the chat picks a time
  active         INTEGER NOT NULL DEFAULT 1, -- 0 once the bot is removed or /stop is sent
  last_sent_date TEXT,                     -- 'YYYY-MM-DD' (UTC); guards against double sends
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Which questions each chat has already received (cleared when a chat runs out).
CREATE TABLE asked (
  chat_id     INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  asked_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (chat_id, question_id)
);

CREATE INDEX chats_due ON chats (active, send_hour);
