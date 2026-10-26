import type { DatabasePool } from "../database/pool.js";
import { ApiError } from "../http/api-error.js";

export class LearnerProgressRepository {
  constructor(private readonly pool: DatabasePool) {}

  async load(userId: string) {
    const result = await this.pool.query<{ progress: Record<string, unknown>; version: number }>(
      "SELECT progress, version FROM learner_progress WHERE user_id = $1", [userId]
    );
    return { learnerProgress: result.rows[0]?.progress ?? null, version: result.rows[0]?.version ?? 0 };
  }

  async save(userId: string, progress: Record<string, unknown>, expectedVersion: number) {
    const conflict = () => new ApiError(409, "PROGRESS_CONFLICT", "Reload saved progress and merge before retrying.");
    if (expectedVersion === 0) {
      try {
        await this.pool.query(
          "INSERT INTO learner_progress (user_id, progress, version) VALUES ($1, $2::jsonb, 1)", [userId, JSON.stringify(progress)]);
        return { version: 1 };
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throw conflict();
        throw error;
      }
    }
    const result = await this.pool.query<{ version: number }>(
        `UPDATE learner_progress SET progress = $2::jsonb, version = version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND version = $3 RETURNING version`, [userId, JSON.stringify(progress), expectedVersion]);
    if (!result.rows[0]) throw conflict();
    return { version: result.rows[0].version };
  }
}
