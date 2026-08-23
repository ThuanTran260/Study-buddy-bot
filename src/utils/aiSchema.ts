import { z } from 'zod';
import { logger } from './logger';

// ----------------------------------------------------
// QUIZ SCHEMA
// ----------------------------------------------------

const QuizOptionSchema = z.object({
  label: z.string().transform((val) => val.trim().toUpperCase().charAt(0)), // A, B, C, D
  text: z.string().min(1).transform((val) => val.trim()),
});

export const QuizQuestionSchema = z.object({
  question: z.string().min(1).transform((val) => val.trim()),
  options: z.array(QuizOptionSchema).length(4, { message: 'Must have exactly 4 options' }),
  correctOption: z.enum(['A', 'B', 'C', 'D']),
  explanation: z.string().default('Đáp án chính xác theo tài liệu bài học.').transform((val) => val.trim()),
});

export const QuizResponseSchema = z.preprocess(
  (val: any) => {
    if (!val) return val;
    const root = Array.isArray(val) && val.length > 0 && typeof val[0] === 'object' && !val[0].question ? val[0] : val;
    const questions = Array.isArray(root) ? root : root.questions || root.quiz || root.test || [];
    return { questions };
  },
  z.object({
    questions: z.array(QuizQuestionSchema).min(1),
  })
);

export type QuizQuestionType = z.infer<typeof QuizQuestionSchema>;

// ----------------------------------------------------
// FLASHCARD SCHEMA
// ----------------------------------------------------

export const FlashcardItemSchema = z.object({
  front: z.string().min(1).max(1000).transform((val) => val.trim()),
  back: z.string().min(1).max(1000).transform((val) => val.trim()),
});

export const FlashcardResponseSchema = z.preprocess(
  (val: any) => {
    if (!val) return val;
    const root = Array.isArray(val) && val.length > 0 && typeof val[0] === 'object' && !val[0].front ? val[0] : val;
    const flashcards = Array.isArray(root) ? root : root.flashcards || root.cards || root.vocabulary || [];
    return { flashcards };
  },
  z.object({
    flashcards: z.array(FlashcardItemSchema).min(1),
  })
);

export type FlashcardItemType = z.infer<typeof FlashcardItemSchema>;

// ----------------------------------------------------
// STUDY PACK SCHEMA
// ----------------------------------------------------

export const StudyPackSchema = z.preprocess(
  (val: any) => {
    if (!val || typeof val !== 'object') return val;
    // Unwrap from array if necessary
    const root = Array.isArray(val) && val.length > 0 && typeof val[0] === 'object' ? val[0] : val;
    
    // Map common aliases
    const summary = root.summary || root.overview || root.mainPoints || root.tomTat || '';
    const flashcards = root.flashcards || root.cards || root.flashcard || root.vocabulary || [];
    const quiz = root.quiz || root.questions || root.test || root.quizzes || [];

    return { summary, flashcards, quiz };
  },
  z.object({
    summary: z.string().min(10).transform((val) => val.trim()),
    flashcards: z.array(FlashcardItemSchema).min(1),
    quiz: z.array(QuizQuestionSchema).min(1),
  })
);

export type StudyPackType = z.infer<typeof StudyPackSchema>;

// ----------------------------------------------------
// HELPER TO PARSE AI RESPONSE
// ----------------------------------------------------

/**
 * Lột bỏ lớp bọc Markdown (```json ... ```) nếu có.
 * Không dùng stack đếm ngoặc phức tạp nữa vì Zod sẽ đảm nhiệm việc validate cấu trúc.
 */
export function stripMarkdownJson(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json/i, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```/i, '');
  }
  
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.replace(/```$/i, '');
  }
  return cleaned.trim();
}

/**
 * Hàm bọc chung để parse và validate an toàn
 */
export function safeParseAIJson<T>(
  raw: string, 
  schema: z.ZodType<T>
): T | null {
  try {
    const stripped = stripMarkdownJson(raw);
    const parsedObj = JSON.parse(stripped);
    
    // Validate bằng Zod
    const result = schema.safeParse(parsedObj);
    if (!result.success) {
      logger.warn('Zod validation failed for AI JSON', { 
        errors: result.error.errors, 
        rawPreview: raw.slice(0, 150) 
      });
      return null;
    }
    
    return result.data;
  } catch (error) {
    logger.error('Failed to parse AI raw JSON', { error: String(error), rawPreview: raw.slice(0, 150) });
    return null;
  }
}
