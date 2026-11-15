# Conversation Cards
_A free and simple way to grow your relationships over Telegram_

One question a day, dropped into a group chat with your partner, friends or family: something to talk about, draw, or photograph together.

## Getting started

1. **[Add Conversation Cards to a group →](https://t.me/conversationcardsbot?startgroup=true)**
   Pick an existing group, or make a new one with the people you want to ask questions with (even just one other person).
2. **Pick a time.** The bot posts a welcome message with time buttons. Times are in UTC; the message shows the current UTC time to help you convert.
3. **That's it.** Your first question arrives right away, then one a day at the time you chose.

### Commands

| Command | What it does |
| --- | --- |
| `/time` | Change when questions arrive |
| `/stop` | Pause daily questions |
| `/start` | Resume, or set up again |
| `/help` | How the bot works |

Each group gets questions in its own random order, with no repeats until it has seen them all. The bot only stores your group's chat ID, its chosen time, and which questions it has received. It can't read your messages.

---

## How it works

A [Cloudflare Worker](https://developers.cloudflare.com/workers/) with a [D1](https://developers.cloudflare.com/d1/) database.

- **`fetch()`, the webhook:** Telegram sends every update (bot added/removed, commands, button taps) to `/webhook`. Requests are verified with a secret header.
- **`scheduled()`, the hourly job:** at the top of each hour (UTC), sends one unasked question to every chat whose chosen hour matches.

```
src/index.js          webhook + hourly job
src/questions.js      picks an unasked question per chat
src/telegram.js       Telegram Bot API helper
questions.json        the question list (built into the Worker on deploy)
migrations/           database tables
scripts/              question helpers + one-time bot setup
```

## Editing questions

Question IDs are permanent, because each chat's history refers to them.

- **Add:** `node scripts/add-question.mjs "Your question?"` assigns the next ID.
- **Fix wording:** edit the text in `questions.json` and keep the ID.
- **Remove:** add `"retired": true` instead of deleting the line.
- **Check:** `npm run check` catches broken JSON, duplicates, and deleted IDs.

Phrase questions so they work for two people or a larger group (use "we/us", "each other", "one of us").

Changes go live on the next deploy.

## Development

```bash
npm install
npx wrangler login
npm run dev        # run locally (add --test-scheduled to test the hourly job)
npm run deploy     # checks questions.json, then deploys
npx wrangler tail  # live logs from the deployed Worker
```

**First-time setup** (already done for the live bot):

1. `npx wrangler d1 migrations apply qotd --remote` creates the tables.
2. `npm run deploy`
3. Create `.dev.vars` (gitignored) containing `BOT_TOKEN=` followed by your token from @BotFather.
4. `node scripts/setup-bot.mjs https://<worker-url>` uploads secrets, registers the webhook, and sets the command menu.

## Future features

- Question categories (talk / draw / photo; light / deep) chosen per group
- A way to submit questions to be added to the list
- Pick a time in your local timezone instead of UTC
