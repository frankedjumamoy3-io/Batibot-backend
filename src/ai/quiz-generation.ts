import { z } from "zod";
import { ApiError } from "../http/api-error.js";
import { quizSchema, grades } from "../quizzes/validation.js";
import { curriculumCatalog } from "../quizzes/curriculum-catalog.js";
import type { ContentGenerator } from "./openai.js";
import { bundledAssetIds } from "../content/bundled-assets.js";

const text = z.string().trim().min(1).max(1000);
export const quizGenerationRequest = z.object({
  topic: text, gradeLevel: grades, learnerLevel: grades, worldId: text, topicId: text,
  phase: z.enum(["Discover", "Explore", "Interact", "Practice", "Challenge", "Reward", "Progress", "Mastery"]).default("Practice"),
  category: z.enum(["linguistic", "numeric", "mixed"]),
  difficulty: z.enum(["beginner", "easy", "medium", "advanced", "mastery"]),
  curriculumLevel: z.number().int().min(1).max(100),
  questionCount: z.number().int().min(1).max(20),
  questionTypes: z.array(z.enum(["multiple-choice", "true-or-false", "word-problem", "text-to-speech", "speech-to-text", "image-choice", "timed-challenge", "ordering", "counting-objects", "compare-numbers", "picture-based", "scenario", "fill-in-the-blank", "matching", "image-to-word", "word-to-image"])).min(1).max(16),
  adminPrompt: z.string().max(6000).default(""), objective: z.string().max(1000).default(""),
  ageGroup: z.string().max(100).default(""), notes: z.string().max(2000).default(""),
  rewardXp: z.number().int().min(0).max(100).default(20),
  vocabularyContext: z.array(z.object({ word: text, meaning: z.string().max(1000).optional(), clue: z.string().max(1000).optional(), sample: z.string().max(1000).optional(), imageAssetId: z.string().max(200).optional() })).max(100).default([]),
}).superRefine((input, ctx) => {
  if (input.gradeLevel !== input.learnerLevel || !curriculumCatalog.some(world => world.gradeLevel === input.gradeLevel && world.worldId === input.worldId && world.topics.includes(input.topicId))) ctx.addIssue({ code: "custom", message: "Unknown curriculum scope." });
});

const string = { type: "string" };
export const quizOutputSchema = {
  type: "object", required: ["title", "objective", "instructions", "questions"],
  properties: {
    title: string, objective: string, instructions: string,
    questions: { type: "array", items: { type: "object", required: ["id", "type", "prompt", "explanation"], properties: {
      id: string, type: string, prompt: string, explanation: string, answer: string,
      options: { type: "array", items: string }, wordBank: { type: "array", items: string },
      sentence: string, audioText: string, imageLabel: string, instruction: string,
      pairs: { type: "array", items: { type: "object", required: ["left", "right"], properties: { left: string, right: string, leftType: string, rightType: string, word: string, assetId: string, altText: string } } },
    } } },
  },
};

export async function generateQuiz(input: z.infer<typeof quizGenerationRequest>, generator: ContentGenerator) {
  const prompt = [
    "Create exactly questionCount distinct questions using only the requested questionTypes and curriculum scope.",
    "Every choice question needs exactly four distinct options and answer equal to one visible option. True/false uses two. Each answer and explanation must be factually correct.",
    "Use short concrete prompts for the selected grade. Practice repeats known content. Challenge changes the task without introducing new content. If approved vocabulary is provided, use it for targets and distractors.",
    "Matching requires at least two pairs with unique left and right values. Use text pairs unless an exact existing imageAssetId is provided; never invent images. Image formats require a matching approved asset from the vocabulary context.",
    "Ordering answer is a comma-separated permutation of options. Fill-in-the-blank requires sentence with ___, wordBank, and answer. Speech-to-text requires answer and audioText. Audio-choice requires audioText.",
    "Return draft content only, without status, review or publication metadata. Administrator review will check factual accuracy before release.",
    JSON.stringify(input),
  ].join("\n");
  const output = await generator.generate(prompt, quizOutputSchema);
  const record = z.record(z.string(), z.unknown()).safeParse(output);
  if (!record.success) throw invalidOutput();
  const candidate = record.data;
  const parsed = quizSchema.safeParse({
    title: candidate.title, instructions: candidate.instructions, questions: candidate.questions,
    ...input, questionTypes: input.questionTypes, status: "draft", createdWith: "openai",
    objective: candidate.objective, notes: "AI draft: review factual accuracy and grade suitability before publishing.", sourcePrompt: input.adminPrompt,
    mobilePreviewChecked: false, previewCheckedAt: null, previewCheckedByUid: null, reviewChecklist: {},
    rewards: { xp: input.rewardXp, stars: 1 }, modelName: generator.model, promptVersion: "2026-10-admin-ai-v1",
  });
  if (!parsed.success || parsed.data.questions.length !== input.questionCount || parsed.data.questions.some(q => !input.questionTypes.includes(q.type))) throw invalidOutput();
  const assets = new Set(input.vocabularyContext.map(word => word.imageAssetId).filter((id): id is string => Boolean(id && bundledAssetIds.has(id))));
  if (parsed.data.questions.some(q => q.pairs?.some(pair => (["image-to-word", "word-to-image"].includes(q.type) || pair.leftType === "image" || pair.rightType === "image") && (!pair.assetId || !assets.has(pair.assetId))))) throw invalidOutput();
  // These renderers cannot display AI-invented media; require a real asset mapping.
  if (parsed.data.questions.some(q => ["image-choice", "picture-based", "counting-objects"].includes(q.type))) throw new ApiError(422, "AI_MEDIA_REQUIRED", "Use a text or matching format until exact image assets are attached.");
  return parsed.data;
}

function invalidOutput() { return new ApiError(422, "AI_INVALID_OUTPUT", "The generated questions failed validation. Adjust the request and try again."); }
