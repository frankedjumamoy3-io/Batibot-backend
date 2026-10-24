import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabasePool } from "../database/pool.js";
import { ApiError } from "../http/api-error.js";
import { canTransition, contentDraftSchema, validateLessonContent, type ContentDraftInput } from "./validation.js";

interface Row { id: string; content: ContentDraftInput; status: string; created_by: string; updated_by: string; created_at: Date; updated_at: Date; published_at: Date | null }
function mapDraft(row: Row) {
  return { ...row.content, id: row.id, status: row.status, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at, publishedAt: row.published_at };
}
function mapPublished(row: Row, admin: boolean) {
  return { id: row.id, draftId: row.id, content: row.content.editedContent, assetRefs: row.content.assetRefs,
    gradeLevel: row.content.gradeLevel, worldId: row.content.worldId, topicTitle: row.content.topicTitle,
    metadata: row.content.metadata, publishedAt: row.published_at, status: "published",
    ...(admin ? { publishedBy: row.updated_by } : {}) };
}
export class ContentRepository {
  constructor(private readonly pool: DatabasePool) {}

  async get(id: string) {
    const result = await this.pool.query<Row>("SELECT * FROM content_drafts WHERE id=$1", [id]);
    if (!result.rows[0]) throw new ApiError(404, "NOT_FOUND", "Draft not found.");
    return mapDraft(result.rows[0]);
  }
  async list(limit: number, offset: number) {
    const result = await this.pool.query<Row>("SELECT * FROM content_drafts ORDER BY updated_at DESC, id LIMIT $1 OFFSET $2", [limit + 1, offset]);
    return { items: result.rows.slice(0, limit).map(mapDraft), nextOffset: result.rows.length > limit ? offset + limit : null };
  }
  async published(admin: boolean, limit: number, offset: number, grade?: string, world?: string) {
    const result = await this.pool.query<Row>(`SELECT * FROM content_drafts WHERE status='published'
      AND ($1::text IS NULL OR grade_level=$1) AND ($2::text IS NULL OR world_id=$2)
      ORDER BY published_at DESC, id LIMIT $3 OFFSET $4`, [grade ?? null, world ?? null, limit + 1, offset]);
    return { items: result.rows.slice(0, limit).map(row => mapPublished(row, admin)), nextOffset: result.rows.length > limit ? offset + limit : null };
  }
  async write(raw: unknown, actor: string, existingId?: string, publish = false) {
    const id = existingId ?? randomUUID();
    const patch = z.record(z.string(), z.unknown()).parse(raw);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const previous = existingId ? (await client.query<Row>("SELECT * FROM content_drafts WHERE id=$1 FOR UPDATE", [id])).rows[0] : undefined;
      if (existingId && !previous) throw new ApiError(404, "NOT_FOUND", "Draft not found.");
      if (previous?.status === "published") throw new ApiError(409, "DRAFT_PUBLISHED", "Create a new draft to revise published content.");
      const input = contentDraftSchema.parse({ ...previous?.content, ...patch, ...(publish ? { status: "published" } : {}) });
      if (!previous && !["draft", "ai_generated", "needs_review", "validation_failed"].includes(input.status)) throw new ApiError(409, "INVALID_TRANSITION", "Save and review the draft first.");
      if (previous && !canTransition(previous.status, input.status)) throw new ApiError(409, "INVALID_TRANSITION", "Complete the draft review workflow first.");
      if (input.status === "published" && (!publish || previous?.status !== "approved")) throw new ApiError(409, "INVALID_TRANSITION", "Approve before publishing.");
      if (previous && ["approved", "published"].includes(input.status) && ["editedContent", "assetRefs", "metadata", "gradeLevel", "worldId", "topicId", "stageType"].some(key => key in patch && JSON.stringify(patch[key]) !== JSON.stringify(previous.content[key as keyof ContentDraftInput]))) throw new ApiError(409, "REVIEW_REQUIRED", "Save content changes as a draft and review them again.");
      if (["approved", "published"].includes(input.status)) {
        validateLessonContent(input.editedContent, input.gradeLevel);
        if (["gradeLevel", "worldId", "topicId", "stageType"].some(key => input.metadata[key] !== input[key as keyof ContentDraftInput])) throw new ApiError(422, "VALIDATION_REQUIRED", "Content metadata must match the draft scope.");
        if (!input.validationResults.length || input.validationResults.some(result => result.severity === "error")) throw new ApiError(422, "VALIDATION_REQUIRED", "Resolve validation errors before approval.");
      }
      if (previous) {
        await client.query(`UPDATE content_drafts SET content=$2,status=$3,updated_by=$4,updated_at=CURRENT_TIMESTAMP,published_at=$5,grade_level=$6,world_id=$7 WHERE id=$1`,
          [id, JSON.stringify(input), input.status, actor, publish ? new Date() : null, input.gradeLevel, input.worldId]);
      } else {
        await client.query("INSERT INTO content_drafts (id,content,status,created_by,updated_by,grade_level,world_id) VALUES ($1,$2,$3,$4,$4,$5,$6)", [id, JSON.stringify(input), input.status, actor, input.gradeLevel, input.worldId]);
      }
      await client.query("INSERT INTO admin_activity_logs (id,actor_user_id,action,entity_type,entity_id) VALUES ($1,$2,$3,'content-draft',$4)", [randomUUID(), actor, publish ? "content-published" : `content-${input.status}`, id]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    if (publish) {
      const row = (await this.pool.query<Row>("SELECT * FROM content_drafts WHERE id=$1", [id])).rows[0]!;
      return mapPublished(row, true);
    }
    return this.get(id);
  }
}
