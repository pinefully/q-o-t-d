// Picks a question a chat hasn't seen yet. Once every question has been
// asked, the chat's history is cleared and the cycle starts again.
import allQuestions from "../questions.json";

const questions = allQuestions.filter((q) => !q.retired);

export async function pickQuestion(db, chatId) {
  const { results } = await db
    .prepare("SELECT question_id FROM asked WHERE chat_id = ?")
    .bind(chatId)
    .all();
  const asked = new Set(results.map((r) => r.question_id));

  let remaining = questions.filter((q) => !asked.has(q.id));
  if (remaining.length === 0) {
    await db.prepare("DELETE FROM asked WHERE chat_id = ?").bind(chatId).run();
    remaining = questions;
  }
  return remaining[Math.floor(Math.random() * remaining.length)];
}

export function recordAsked(db, chatId, questionId, today) {
  return db.batch([
    db.prepare("INSERT OR IGNORE INTO asked (chat_id, question_id) VALUES (?, ?)").bind(chatId, questionId),
    db.prepare("UPDATE chats SET last_sent_date = ? WHERE chat_id = ?").bind(today, chatId),
  ]);
}
