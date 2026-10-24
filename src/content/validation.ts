import { z } from "zod";
import { grades, normalizeAnswer } from "../quizzes/validation.js";
import { curriculumCatalog } from "../quizzes/curriculum-catalog.js";
import { bundledAssetIds } from "./bundled-assets.js";

const text = z.string().trim().min(1).max(2000);
const optionalText = z.string().max(4000).optional();
export const stageLabels = ["LOOK", "TAP", "TRY", "CHOOSE", "PLAY", "REWARD", "PROGRESS", "MASTERY"] as const;
export const assetRefsSchema = z.object({
  audio: z.array(text).max(100), backgrounds: z.array(text).max(100), icons: z.array(text).max(100), images: z.array(text).max(100),
});
export const lessonMetadataSchema = z.object({
  gradeLevel: grades, worldId: text, topicId: text, topicTitle: text,
  stageType: z.enum(["LOOK", "TAP", "TRY", "CHOOSE", "PLAY", "REWARD"]),
  contentRules: z.record(z.string(), z.boolean()),
  learnerUiSchema: z.object({
    requiresChoices: z.boolean(), requiresCorrectAnswer: z.boolean(), supportsAssets: z.boolean(),
  }).passthrough(),
  existingAssetRefs: assetRefsSchema,
}).passthrough();
export const stageSchema = z.object({
  id: text, stageLabel: z.enum(stageLabels), activityType: text,
  title: text, instruction: z.string().trim().min(1).max(90),
  body: optionalText, meaning: optionalText, example: optionalText, question: optionalText,
  feedbackCorrect: text, feedbackIncorrect: text,
  choices: z.array(z.object({ id: text, label: z.string().min(1).max(90), isCorrect: z.boolean() })).max(4).optional(),
  correctAnswer: optionalText,
  items: z.array(z.object({ id: text, left: text, right: text })).min(2).max(12).optional(),
  assetRefs: assetRefsSchema,
});
export const generatedContentSchema = z.object({
  title: text, topicTitle: text, topicType: text,
  instruction: z.string().min(1).max(90), content: text,
  feedbackCorrect: text, feedbackIncorrect: text,
  examples: z.array(z.object({ label: text, explanation: text })).max(10),
  stages: z.array(stageSchema).length(8), assetRefs: assetRefsSchema,
});
export const contentGenerationRequest = z.object({
  gradeLevel: grades, worldId: text, topicId: text, topicTitle: text, topicType: text,
  adminPrompt: z.string().max(6000).default(""),
  request: z.object({ stageType: z.enum(["LOOK", "TAP", "TRY", "CHOOSE", "PLAY", "REWARD"]) }),
  metadata: lessonMetadataSchema,
  geminiContentPrompt: z.string().max(30000), geminiDraftPrompt: z.string().max(30000),
  maxExamples: z.number().int().min(1).max(10).default(4),
}).superRefine((input, ctx) => {
  if (!validScope(input)) ctx.addIssue({ code: "custom", message: "Unknown curriculum scope." });
});
export function validScope(input: { gradeLevel: string; worldId: string; topicId: string }) {
  const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return curriculumCatalog.some(world => world.gradeLevel === input.gradeLevel && world.worldId === input.worldId && world.topics.some(topic => key(topic) === key(input.topicId)));
}

// Validate the same content at generation, approval and publication. Client review flags alone cannot bypass this.
export function validateLessonContent(value: unknown, gradeLevel: string) {
  const content = generatedContentSchema.parse(value);
  const invalid = (message: string) => { throw new z.ZodError([{ code: "custom", path: ["stages"], message }]); };
  if (new Set(content.stages.map(stage => stage.stageLabel)).size !== 8 || new Set(content.stages.map(stage => stage.id)).size !== 8) invalid("Each learning stage must occur once.");
  for (const stage of content.stages) {
    if (Object.values(stage.assetRefs).flat().some(ref => !bundledAssetIds.has(ref))) invalid("Use an existing bundled asset.");
    if (["LOOK", "REWARD", "PROGRESS", "MASTERY"].includes(stage.stageLabel) && !stage.body?.trim()) invalid("Each information stage needs learner-facing content.");
    if (["TRY", "CHOOSE"].includes(stage.stageLabel)) {
      if (!stage.question?.trim()) invalid("Practice stages need a question.");
      const choices = stage.choices ?? [];
      const correct = choices.filter(choice => choice.isCorrect);
      if (![2, 4].includes(choices.length) || correct.length !== 1 || correct[0]?.id !== stage.correctAnswer ||
        new Set(choices.map(choice => choice.id)).size !== choices.length ||
        new Set(choices.map(choice => normalizeAnswer(choice.label))).size !== choices.length) invalid("Choices need distinct visible labels and one valid answer ID.");
    }
    if (stage.stageLabel === "TAP" && !stage.meaning?.trim()) invalid("TAP needs an explanation.");
    if (stage.stageLabel === "PLAY") {
      // This structured draft contract supports matching missions, which the learner renderer understands.
      if (stage.activityType !== "matching" || !stage.items || new Set(stage.items.map(pair => pair.id)).size !== stage.items.length || ["left", "right"].some(side => new Set(stage.items!.map(pair => normalizeAnswer(pair[side as "left" | "right"]))).size !== stage.items!.length)) invalid("PLAY requires a meaningful matching mission with unique pairs.");
    }
  }
  if (Object.values(content.assetRefs).flat().some(ref => !bundledAssetIds.has(ref))) invalid("Use an existing bundled asset.");
  if (!grades.safeParse(gradeLevel).success) invalid("Unknown learner grade.");
  if (/\b(?:lorem ipsum|placeholder|todo)\b/i.test(JSON.stringify(content))) invalid("Replace placeholder content before review.");
  return content;
}

export const draftStatus = z.enum(["draft", "ai_generated", "needs_review", "validation_failed", "approved", "published", "rejected"]);
export const contentDraftSchema = z.object({
  adminPrompt: z.string().max(6000), assetRefs: assetRefsSchema,
  contentKind: z.enum(["meaning", "example", "readingPassage", "story", "instruction", "activity", "question", "assessment", "playActivity"]),
  editedContent: z.record(z.string(), z.unknown()), generatedContent: z.record(z.string(), z.unknown()),
  gradeLevel: grades, metadata: lessonMetadataSchema,
  requestId: text, stageType: z.enum(["LOOK", "TAP", "TRY", "CHOOSE", "PLAY", "REWARD"]),
  status: draftStatus.default("draft"), topicId: text, topicTitle: text, topicType: text, worldId: text,
  rejectionNotes: z.string().max(4000).default(""), validationResults: z.array(z.record(z.string(), z.unknown())).max(500).default([]),
}).superRefine((draft, ctx) => { if (!validScope(draft)) ctx.addIssue({ code: "custom", message: "Unknown curriculum scope." }); });
export type ContentDraftInput = z.infer<typeof contentDraftSchema>;

export function canTransition(from: string, to: string) {
  const allowed: Record<string, string[]> = {
    draft: ["ai_generated", "needs_review", "validation_failed", "rejected"],
    ai_generated: ["draft", "needs_review", "validation_failed", "rejected"],
    needs_review: ["approved", "draft", "validation_failed", "rejected"],
    validation_failed: ["draft", "needs_review", "rejected"], approved: ["draft", "published", "rejected"],
    rejected: ["draft"], published: [],
  };
  return from === to || allowed[from]?.includes(to) === true;
}
