import { z } from "zod";
import { curriculumCatalog } from "./curriculum-catalog.js";

const text = z.string().trim().min(1).max(1000);
const optionalText = z.string().trim().max(2000).optional();
export const grades = z.enum(["Preschool", "Kindergarten", "Grade 1", "Grade 2", "Grade 3"]);
const phases = z.enum(["Discover", "Explore", "Interact", "Practice", "Challenge", "Reward", "Progress", "Mastery"]);
const pair = z.object({ left: text, right: text, leftType: z.enum(["text", "word", "image"]).optional(), rightType: z.enum(["text", "word", "image"]).optional(), word: optionalText, imagePrompt: optionalText, altText: optionalText, assetId: optionalText });
const layouts = z.enum(["multiple-choice", "true-or-false", "word-problem", "text-to-speech", "speech-to-text", "image-choice", "timed-challenge", "ordering", "counting-objects", "compare-numbers", "picture-based", "scenario", "fill-in-the-blank", "matching", "image-to-word", "word-to-image"]);

export function normalizeAnswer(value: string) {
  const normalized = value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  const numbers: Record<string, string> = { zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10" };
  if (numbers[normalized]) return numbers[normalized];
  return /^[-+]?\d+(\.\d+)?$/.test(normalized) ? String(Number(normalized)) : normalized;
}

export const questionSchema = z.object({
  id: text, type: layouts, prompt: text, answer: optionalText,
  options: z.array(text).max(12).optional(), wordBank: z.array(text).max(12).optional(),
  sentence: optionalText, instruction: optionalText, pairs: z.array(pair).min(2).max(12).optional(),
  explanation: optionalText, audioText: optionalText, helperText: optionalText, imageLabel: optionalText,
  interactionType: z.enum(["tap-choice", "typed-answer", "tap-or-drag-match", "drag-sequence", "audio-choice", "speech-response", "image-choice", "story-choice"]).optional(),
}).superRefine((q, ctx) => {
  const invalid = () => ctx.addIssue({ code: "custom", message: "Question must have distinct choices and one valid target." });
  if (["matching", "image-to-word", "word-to-image"].includes(q.type)) {
    if (!q.pairs || ["left", "right"].some(side => new Set(q.pairs!.map(p => normalizeAnswer(p[side as "left" | "right"]))).size !== q.pairs!.length)) invalid();
    return;
  }
  if (!q.answer?.trim()) { invalid(); return; }
  if (q.type === "speech-to-text") return;
  const choices = q.type === "fill-in-the-blank" ? q.wordBank : q.options;
  if (!choices || choices.length < 2 || new Set(choices.map(normalizeAnswer)).size !== choices.length) { invalid(); return; }
  if (q.type === "ordering") {
    const sequence = q.answer.split(/\s*(?:,|\||→|->)\s*/).map(normalizeAnswer);
    if (sequence.length !== choices.length || new Set(sequence).size !== choices.length || sequence.some(item => !choices.map(normalizeAnswer).includes(item))) invalid();
  } else if (choices.filter(choice => normalizeAnswer(choice) === normalizeAnswer(q.answer!)).length !== 1) invalid();
  if (q.type === "fill-in-the-blank" && !q.sentence?.includes("_")) invalid();
}).transform(q => {
  // Store the exact visible choice so the APK's text answer comparison agrees
  // with server normalization (for example, answer "one" and choice "1").
  const choices = q.type === "fill-in-the-blank" ? q.wordBank : q.options;
  if (q.answer && q.type !== "ordering" && q.type !== "speech-to-text") {
    const visibleAnswer = choices?.find(choice => normalizeAnswer(choice) === normalizeAnswer(q.answer!));
    if (visibleAnswer) return { ...q, answer: visibleAnswer };
  }
  return q;
});

// Only known mobile presentation fields survive validation. Audit/identity fields are server-owned.
export const quizSchema = z.object({
  title: text, topic: text, objective: text, instructions: text,
  gradeLevel: grades, learnerLevel: grades, worldId: text, topicId: text, phase: phases,
  category: z.enum(["linguistic", "numeric", "mixed"]),
  difficulty: z.enum(["beginner", "easy", "medium", "advanced", "mastery"]),
  curriculumLevel: z.number().int().min(1).max(100),
  status: z.enum(["draft", "ready-for-review", "published", "archived"]).default("draft"),
  questions: z.array(questionSchema).min(1).max(50),
  ageGroup: optionalText, notes: optionalText, sourcePrompt: optionalText,
  createdWith: z.enum(["gemini", "local-fallback"]).default("local-fallback"),
  questionTypes: z.array(layouts).max(16),
  rewards: z.object({ xp: z.number().int().min(0).max(500), stars: z.number().int().min(0).max(3).optional(), badge: optionalText, mastery: z.boolean().optional(), nextUnlockId: optionalText, rankProgress: z.number().min(0).max(100).optional(), rewardProgress: z.number().min(0).max(100).optional(), unlockMessage: optionalText }),
  unlockRequirements: z.record(z.string(), z.unknown()).optional(),
  reviewChecklist: z.record(z.string(), z.boolean()).optional(),
  lifecycleStatus: optionalText, mobilePreviewChecked: z.boolean().optional(),
  previewCheckedAt: optionalText.nullable(), previewCheckedByUid: optionalText.nullable(),
  node: z.number().int().min(1).max(100).optional(), assetId: optionalText, unlockRewardMapping: optionalText,
}).superRefine((quiz, ctx) => {
  const world = curriculumCatalog.find(item => item.gradeLevel === quiz.gradeLevel && item.worldId === quiz.worldId);
  if (!world || !world.topics.includes(quiz.topicId) || quiz.learnerLevel !== quiz.gradeLevel) ctx.addIssue({ code: "custom", message: "Grade, world and topic must match the bundled curriculum." });
  if (new Set(quiz.questions.map(q => q.id)).size !== quiz.questions.length) ctx.addIssue({ code: "custom", message: "Question IDs must be unique." });
  if (new Set(quiz.questions.map(q => normalizeAnswer(q.prompt))).size !== quiz.questions.length) ctx.addIssue({ code: "custom", message: "Question prompts must be distinct." });
  if (quiz.status === "published") {
    const checks = ["ageAppropriate", "objectiveClear", "instructionsUnderstandable", "questionsComplete", "answersValid", "noDuplicateQuestions", "noBrokenMatchingPairs", "noLowQualityAiOutput", "topicMatchesCurriculum", "questionCountAcceptable"];
    if (!quiz.mobilePreviewChecked || checks.some(key => quiz.reviewChecklist?.[key] !== true)) ctx.addIssue({ code: "custom", message: "Complete the mobile preview and review checklist before publishing." });
  }
  for (const q of quiz.questions) {
    if (["Preschool", "Kindergarten"].includes(quiz.gradeLevel) && q.options && q.type !== "ordering" && q.type !== "speech-to-text" && ![2, 4].includes(q.options.length)) ctx.addIssue({ code: "custom", message: "Early learner choices must contain two or four options." });
  }
});

export type QuizInput = z.infer<typeof quizSchema>;
export const paginationSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).max(100000).default(0), gradeLevel: grades.optional() });
export const attemptSchema = z.strictObject({ quizId: z.uuid(), score: z.number().int().min(0), totalQuestions: z.number().int().min(1).max(50) }).refine(v => v.score <= v.totalQuestions);
