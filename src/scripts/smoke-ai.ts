import "dotenv/config";
import { OpenAIGenerator } from "../ai/openai.js";
import { generateQuiz, quizGenerationRequest } from "../ai/quiz-generation.js";
import { loadEnvironment } from "../config/environment.js";
import { ApiError } from "../http/api-error.js";

// Opt-in live provider test. Uses one generic curriculum request; saves/publishes nothing.
const generator = new OpenAIGenerator(loadEnvironment());
try {
  const quiz = await generateQuiz(quizGenerationRequest.parse({
    topic: "Mother", gradeLevel: "Preschool", learnerLevel: "Preschool", worldId: "preschool-family-world", topicId: "Mother",
    phase: "Practice", category: "linguistic", curriculumLevel: 1, difficulty: "beginner", questionCount: 2,
    questionTypes: ["multiple-choice"], adminPrompt: "Use short family vocabulary questions with distinct prompts.",
  }), generator);
  console.log(JSON.stringify({ status: "passed", model: generator.model, questions: quiz.questions.length, saved: false }));
} catch (error) {
  console.error(JSON.stringify({ status: "failed", code: error instanceof ApiError ? error.code : "VALIDATION_FAILED" }));
  process.exitCode = 1;
}
