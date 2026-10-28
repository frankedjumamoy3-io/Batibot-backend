import type { DatabasePool } from "../database/pool.js";

type RecordValue = Record<string, unknown>;
interface LearnerRow { id: string; display_name: string; grade_level: string | null; created_at: Date; progress: RecordValue | null; progress_updated_at: Date | null }
interface QuizRow { id: string; title: string; grade_level: string; world_id: string | null; status: string }
interface ContentRow { id: string; grade_level: string; world_id: string; status: string }
interface ActivityRow { action: string; entity_type: string; created_at: Date }

const GRADES = ["Preschool", "Kindergarten", "Grade 1", "Grade 2", "Grade 3"];
const asRecord = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const asNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
const asDate = (value: Date | string | null) => value ? new Date(value).toISOString() : null;

export class AdminInsightsRepository {
  constructor(private readonly pool: DatabasePool) {}

  async load() {
    const [learnersResult, quizzesResult, contentResult, activityResult] = await Promise.all([
      this.pool.query<LearnerRow>(`SELECT u.id, u.display_name, u.grade_level, u.created_at,
        p.progress, p.updated_at AS progress_updated_at FROM app_users u
        LEFT JOIN learner_progress p ON p.user_id = u.id
        WHERE u.role = 'learner' AND u.status = 'active' ORDER BY u.created_at DESC`),
      this.pool.query<QuizRow>("SELECT id, title, grade_level, world_id, status FROM curated_quizzes"),
      this.pool.query<ContentRow>("SELECT id, grade_level, world_id, status FROM content_drafts"),
      this.pool.query<ActivityRow>("SELECT action, entity_type, created_at FROM admin_activity_logs ORDER BY created_at DESC, id DESC LIMIT 100"),
    ]);
    const now = Date.now();
    const activeSince = now - 30 * 24 * 60 * 60 * 1000;
    const quizTitles = new Map(quizzesResult.rows.map(row => [row.id, row.title]));
    const scoresByQuiz = new Map<string, { id: string; title: string; gradeLevel: string; attempts: number; learners: number; latestScoreTotal: number }>();
    const byGrade: Record<string, { learners: number; activeLearners: number; completedLessons: number; savedQuizAttempts: number; publishedQuizzes: number; publishedStages: number }> =
      Object.fromEntries(GRADES.map(grade => [grade, { learners: 0, activeLearners: 0, completedLessons: 0, savedQuizAttempts: 0, publishedQuizzes: 0, publishedStages: 0 }]));
    let totalLessons = 0;
    let totalTopics = 0;
    let totalAttempts = 0;
    let scoreTotal = 0;
    let scoreCount = 0;
    let activeLearners = 0;
    const learners = learnersResult.rows.map(row => {
      const progress = asRecord(row.progress);
      const grade = row.grade_level && byGrade[row.grade_level] ? row.grade_level : "Unknown";
      byGrade[grade] ??= { learners: 0, activeLearners: 0, completedLessons: 0, savedQuizAttempts: 0, publishedQuizzes: 0, publishedStages: 0 };
      const gradeData = byGrade[grade];
      gradeData.learners++;
      const lastActiveAt = asDate(row.progress_updated_at);
      const active = lastActiveAt !== null && new Date(lastActiveAt).getTime() >= activeSince;
      if (active) { activeLearners++; gradeData.activeLearners++; }
      const completedLessons = asArray(progress.completedLessons).length;
      const completedTopics = Object.keys(asRecord(progress.masteredTopics)).length;
      const quizScores = asRecord(progress.quizScores);
      let savedQuizAttempts = 0;
      let learnerScoreTotal = 0;
      let learnerScoreCount = 0;
      for (const [rawId, value] of Object.entries(quizScores)) {
        const score = asRecord(value);
        const attempts = Math.floor(asNumber(score.attempts));
        const latest = typeof score.percentage === "number" && Number.isFinite(score.percentage) && score.percentage >= 0 && score.percentage <= 100 ? score.percentage : null;
        savedQuizAttempts += attempts;
        if (latest === null) continue;
        learnerScoreTotal += latest;
        learnerScoreCount++;
        scoreTotal += latest;
        scoreCount++;
        const quizId = rawId.startsWith("curated-") ? rawId.slice(8) : rawId;
        const scoreKey = `${grade}:${rawId}`;
        const current = scoresByQuiz.get(scoreKey) ?? { id: rawId, title: quizTitles.get(quizId) ?? rawId, gradeLevel: grade, attempts: 0, learners: 0, latestScoreTotal: 0 };
        current.attempts += attempts;
        current.learners++;
        current.latestScoreTotal += latest;
        scoresByQuiz.set(scoreKey, current);
      }
      totalLessons += completedLessons;
      totalTopics += completedTopics;
      totalAttempts += savedQuizAttempts;
      gradeData.completedLessons += completedLessons;
      gradeData.savedQuizAttempts += savedQuizAttempts;
      return { id: row.id, displayName: row.display_name, gradeLevel: grade, createdAt: asDate(row.created_at),
        lastActiveAt, totalXp: asNumber(progress.totalXp), completedLessons, completedTopics, savedQuizAttempts,
        averageLatestScore: learnerScoreCount ? Math.round(learnerScoreTotal / learnerScoreCount) : null };
    });
    const quizStatus: Record<string, number> = { draft: 0, published: 0, archived: 0 };
    const worldCoverage = new Map<string, { gradeLevel: string; worldId: string; publishedStages: number; draftStages: number; publishedQuizzes: number; draftQuizzes: number }>();
    const coverageRow = (gradeLevel: string, worldId: string) => {
      const key = `${gradeLevel}:${worldId}`;
      const current = worldCoverage.get(key) ?? { gradeLevel, worldId, publishedStages: 0, draftStages: 0, publishedQuizzes: 0, draftQuizzes: 0 };
      worldCoverage.set(key, current);
      return current;
    };
    for (const quiz of quizzesResult.rows) {
      quizStatus[quiz.status] = (quizStatus[quiz.status] ?? 0) + 1;
      const coverage = coverageRow(quiz.grade_level, quiz.world_id ?? "Unassigned");
      if (quiz.status === "published") {
        coverage.publishedQuizzes++;
        const gradeData = byGrade[quiz.grade_level] ??= { learners: 0, activeLearners: 0, completedLessons: 0, savedQuizAttempts: 0, publishedQuizzes: 0, publishedStages: 0 };
        gradeData.publishedQuizzes++;
      } else if (quiz.status === "draft") coverage.draftQuizzes++;
    }
    const contentStatus: Record<string, number> = {};
    for (const item of contentResult.rows) {
      contentStatus[item.status] = (contentStatus[item.status] ?? 0) + 1;
      const current = coverageRow(item.grade_level, item.world_id);
      if (item.status === "published") {
        current.publishedStages++;
        const gradeData = byGrade[item.grade_level] ??= { learners: 0, activeLearners: 0, completedLessons: 0, savedQuizAttempts: 0, publishedQuizzes: 0, publishedStages: 0 };
        gradeData.publishedStages++;
      } else current.draftStages++;
    }
    return {
      generatedAt: new Date().toISOString(),
      learners: { total: learners.length, active30Days: activeLearners, completedLessons: totalLessons,
        masteredTopics: totalTopics, savedQuizAttempts: totalAttempts,
        averageLatestScore: scoreCount ? Math.round(scoreTotal / scoreCount) : null, byGrade },
      content: { quizStatus, contentStatus, worldCoverage: [...worldCoverage.values()] },
      learnerRows: learners,
      quizPerformance: [...scoresByQuiz.values()].map(item => ({ id: item.id, title: item.title,
        attempts: item.attempts, learners: item.learners,
        averageLatestScore: Math.round(item.latestScoreTotal / item.learners) }))
        .sort((a, b) => b.attempts - a.attempts),
      recentActivity: activityResult.rows.map(row => ({ action: row.action, entityType: row.entity_type,
        timestamp: asDate(row.created_at) })),
    };
  }
}
