import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { DatabasePool } from "../database/pool.js";
import { ApiError } from "../http/api-error.js";
import { quizSchema, type QuizInput } from "./validation.js";

interface QuizRow { id: string; content: QuizInput; status: string; version: number; created_by: string; created_at: Date; updated_at: Date; published_at: Date | null }
function mapQuiz(row: QuizRow, admin: boolean) {
  const publicContent = { ...row.content };
  delete publicContent.notes;
  delete publicContent.sourcePrompt;
  delete publicContent.reviewChecklist;
  delete publicContent.previewCheckedByUid;
  return { ...(admin ? row.content : publicContent), id: row.id, status: row.status === "draft" ? row.content.status : row.status, version: row.version,
    createdAt: row.created_at, updatedAt: row.updated_at, publishedAt: row.published_at, archivedAt: null,
    ...(admin ? { createdByUid: row.created_by, createdByEmail: "" } : {}) };
}
export class QuizRepository {
  constructor(private readonly pool: DatabasePool) {}

  async list(admin: boolean, limit: number, offset: number, grade?: string) {
    const result = await this.pool.query<QuizRow>(
      `SELECT * FROM curated_quizzes WHERE ($1::boolean = TRUE OR status = 'published')
       AND ($2::text IS NULL OR grade_level = $2) ORDER BY updated_at DESC, id LIMIT $3 OFFSET $4`, [admin, grade ?? null, limit + 1, offset]);
    return { items: result.rows.slice(0, limit).map(row => mapQuiz(row, admin)), nextOffset: result.rows.length > limit ? offset + limit : null };
  }

  async get(id: string, admin: boolean) {
    const result = await this.pool.query<QuizRow>("SELECT * FROM curated_quizzes WHERE id = $1", [id]);
    const row = result.rows[0];
    if (!row || (!admin && row.status !== "published")) throw new ApiError(404, "NOT_FOUND", "Quiz not found.");
    return mapQuiz(row, admin);
  }

  async write(input: unknown, actor: string, id: string = randomUUID(), update = false) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      let content: QuizInput;
      if (update) {
        const previous = await client.query<QuizRow>("SELECT * FROM curated_quizzes WHERE id = $1 FOR UPDATE", [id]);
        if (!previous.rows[0]) throw new ApiError(404, "NOT_FOUND", "Quiz not found.");
        content = quizSchema.parse({ ...previous.rows[0].content, ...(input as object) });
      } else content = quizSchema.parse(input);
      const status = content.status === "ready-for-review" ? "draft" : content.status;
      const values = [id, content.title, content.objective, content.gradeLevel, content.worldId, content.topicId, status, actor, JSON.stringify(content), content.phase, status === "published" ? new Date() : null];
      if (update) {
        await client.query(`UPDATE curated_quizzes SET title=$2, description=$3, grade_level=$4, world_id=$5, topic_id=$6, status=$7, updated_by=$8, content=$9, phase=$10, published_at=$11, version=version+1, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, values);
        await client.query("DELETE FROM quiz_questions WHERE quiz_id = $1", [id]);
      } else {
        await client.query(`INSERT INTO curated_quizzes (id,title,description,grade_level,world_id,topic_id,status,created_by,updated_by,content,phase,published_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11)`, values);
      }
      for (const [position, q] of content.questions.entries()) {
        await client.query(`INSERT INTO quiz_questions (id,quiz_id,position,prompt,choices,correct_answers,explanation,content) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [randomUUID(), id, position, q.prompt, JSON.stringify(q.options ?? q.wordBank ?? q.pairs ?? []), JSON.stringify(q.answer ? [q.answer] : q.pairs), q.explanation ?? "", JSON.stringify(q)]);
      }
      await this.log(client, actor, id, status === "published" ? "quiz-published" : update ? "quiz-edited" : "quiz-draft-created");
      await client.query("COMMIT");
      return this.get(id, true);
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async remove(id: string, actor: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<QuizRow>("SELECT * FROM curated_quizzes WHERE id=$1 FOR UPDATE", [id]);
      if (!result.rows[0]) throw new ApiError(404, "NOT_FOUND", "Quiz not found.");
      if (result.rows[0].status === "published") throw new ApiError(409, "QUIZ_PUBLISHED", "Unpublish the quiz before deleting it.");
      await client.query("DELETE FROM curated_quizzes WHERE id=$1", [id]);
      await this.log(client, actor, id, "draft-deleted");
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async activity(limit: number, offset: number) {
    const result = await this.pool.query("SELECT * FROM admin_activity_logs ORDER BY created_at DESC, id LIMIT $1 OFFSET $2", [limit + 1, offset]);
    return { items: result.rows.slice(0, limit).map(row => ({ id: row.id, actionType: row.action, quizId: row.entity_id, adminUid: row.actor_user_id, adminEmail: "", timestamp: row.created_at, details: row.action })), nextOffset: result.rows.length > limit ? offset + limit : null };
  }

  async attempt(input: { quizId: string; score: number; totalQuestions: number }) {
    const quiz = await this.get(input.quizId, false);
    if (quiz.questions.length !== input.totalQuestions) throw new ApiError(400, "INVALID_REQUEST", "The attempt does not match this quiz.");
    const id = randomUUID();
    await this.pool.query(`INSERT INTO quiz_attempts (id,quiz_id,score,total_questions,is_test_account,exclude_from_analytics,exclude_from_leaderboard) VALUES ($1,$2,$3,$4,TRUE,TRUE,TRUE)`, [id, input.quizId, input.score, input.totalQuestions]);
    return { id };
  }

  async stats() {
    const counts = await this.pool.query<{ status: string; count: string }>(
      `SELECT status, COUNT(*)::text as count FROM curated_quizzes GROUP BY status`
    );
    const attempts = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM quiz_attempts`
    );
    const logs = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM admin_activity_logs`
    );
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const row of counts.rows) {
      const c = parseInt(row.count, 10) || 0;
      byStatus[row.status] = c;
      total += c;
    }
    return {
      totalQuizzes: total,
      publishedQuizzes: byStatus["published"] ?? 0,
      draftQuizzes: byStatus["draft"] ?? 0,
      archivedQuizzes: byStatus["archived"] ?? 0,
      totalAttempts: parseInt(attempts.rows[0]?.count ?? "0", 10) || 0,
      totalActivityLogs: parseInt(logs.rows[0]?.count ?? "0", 10) || 0,
    };
  }

  private async log(client: pg.PoolClient, actor: string, id: string, action: string) {
    await client.query(`INSERT INTO admin_activity_logs (id,actor_user_id,action,entity_type,entity_id) VALUES ($1,$2,$3,'quiz',$4)`, [randomUUID(), actor, action, id]);
  }
}
