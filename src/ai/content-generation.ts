import { z } from "zod";
import { ApiError } from "../http/api-error.js";
import { type contentGenerationRequest, generatedContentSchema, validateLessonContent } from "../content/validation.js";
import type { ContentGenerator } from "./openai.js";

export async function generateLesson(input: z.infer<typeof contentGenerationRequest>, generator: ContentGenerator) {
  const prompt = [
    "Generate a complete eight-stage lesson for the specified curriculum topic. Include LOOK, TAP, TRY, CHOOSE, PLAY, REWARD, PROGRESS, MASTERY exactly once.",
    "Each instruction is at most 90 characters. TAP includes a meaning. TRY and CHOOSE each have two or four unique choices with one isCorrect=true and correctAnswer equal to that choice's id.",
    "PLAY is a matching mission: activityType=matching, at least two items with id, left and right. Each left/right must be distinct and factually matched. Use the known lesson content. Never use multiple-choice for PLAY.",
    "Use exact supplied asset references only. Never invent an asset ID, URI or filename. If none fits, leave assetRefs arrays empty. Do not create placeholders.",
    "Include body text for LOOK, TAP, REWARD, PROGRESS and MASTERY. All stages include encouraging feedbackCorrect and feedbackIncorrect. Do not claim progress has been saved or grant rewards; the app controls these.",
    "Return the schema exactly; no status, approval or publication fields. The lesson remains a reviewable draft.",
    JSON.stringify(input),
  ].join("\n");
  const output = await generator.generate(prompt, z.toJSONSchema(generatedContentSchema));
  try {
    const content = validateLessonContent(output, input.gradeLevel);
    if (content.topicTitle.trim().toLowerCase() !== input.topicTitle.trim().toLowerCase() || content.topicType !== input.topicType) throw new Error("Topic scope changed");
    if (content.examples.length > input.maxExamples) throw new Error("Too many examples");
    const allowedRefs = new Set(Object.values((input.metadata.existingAssetRefs ?? {}) as Record<string, unknown>).flatMap(value => Array.isArray(value) ? value : []));
    for (const refs of [content.assetRefs, ...content.stages.map(stage => stage.assetRefs)]) {
      if (Object.values(refs).flat().some(ref => !allowedRefs.has(ref))) throw new Error("Unknown asset");
    }
    const selected = content.stages.find(stage => stage.stageLabel === input.request.stageType)!;
    return { ...content, ...selected, stages: content.stages, stageType: input.request.stageType, modelName: generator.model };
  } catch { throw new ApiError(422, "AI_INVALID_OUTPUT", "The generated lesson failed validation. Adjust the request and try again."); }
}
