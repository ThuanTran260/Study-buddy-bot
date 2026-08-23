import { z } from 'zod';
import { logger } from './logger';

// ----------------------------------------------------
// QUIZ SCHEMA
// ----------------------------------------------------

export const QuizOptionSchema = z.object({
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
    const rawQuestions = Array.isArray(root) ? root : root.questions || root.quiz || root.test || root.quizzes || [];
    
    if (!Array.isArray(rawQuestions)) return { questions: [] };

    const labels = ['A', 'B', 'C', 'D'];
    const validOptionsSet = new Set(labels);

    const questions = rawQuestions.map((q: any) => {
      if (!q || typeof q !== 'object') return q;
      const questionText = (q.question || q.cauHoi || q.prompt || '').toString().trim();
      
      let options: { label: string; text: string }[] = [];
      if (Array.isArray(q.options)) {
        if (q.options.length >= 2 && typeof q.options[0] === 'object' && q.options[0] !== null) {
          options = q.options.map((o: any, idx: number) => ({
            label: (o.label || labels[idx] || 'A').toString().toUpperCase().trim().charAt(0),
            text: (o.text || o.content || o.value || '').toString().trim(),
          }));
        } else if (q.options.length >= 2 && typeof q.options[0] === 'string') {
          options = q.options.map((optText: string, idx: number) => ({
            label: labels[idx] || 'A',
            text: optText.replace(/^[A-D][\.\:\)\-]\s*/i, '').trim(),
          }));
        }
      } else if (typeof q.options === 'object' && q.options !== null) {
        for (let i = 0; i < labels.length; i++) {
          const l = labels[i];
          const optVal = q.options[l] || q.options[l.toLowerCase()];
          if (optVal) {
            options.push({ label: l, text: optVal.toString().trim() });
          }
        }
      }

      while (options.length > 0 && options.length < 4) {
        const nextLabel = labels[options.length];
        options.push({
          label: nextLabel,
          text: options.length === 2 ? 'Không có đáp án phù hợp' : 'Cả hai phương án trên đều sai',
        });
      }

      let correctOption = 'A';
      const rawCorrect = (q.correctOption || q.answer || q.correct || q.dapAn || 'A').toString().trim();
      const firstChar = rawCorrect.toUpperCase().charAt(0);
      if (validOptionsSet.has(firstChar)) {
        correctOption = firstChar;
      } else {
        const matchedIndex = options.findIndex(
          (o) => o.text.toLowerCase() === rawCorrect.toLowerCase() || rawCorrect.toLowerCase().includes(o.text.toLowerCase())
        );
        if (matchedIndex !== -1 && labels[matchedIndex]) {
          correctOption = labels[matchedIndex];
        }
      }

      const explanation = (q.explanation || q.reason || q.giaiThich || 'Đáp án chính xác theo tài liệu bài học.').toString().trim();

      return {
        question: questionText,
        options,
        correctOption,
        explanation,
      };
    });

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
    const rawCards = Array.isArray(root) ? root : root.flashcards || root.cards || root.vocabulary || root.items || [];
    
    if (!Array.isArray(rawCards)) return { flashcards: [] };

    const flashcards = rawCards.map((c: any) => {
      if (!c || typeof c !== 'object') return c;
      const front = (c.front || c.term || c.question || c.concept || c.key || '').toString().trim();
      const back = (c.back || c.definition || c.answer || c.meaning || c.explanation || c.value || '').toString().trim();
      return { front, back };
    });

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

    let root = val;
    if (Array.isArray(root) && root.length > 0 && typeof root[0] === 'object') {
      root = root[0];
    }
    if (root.studyPack && typeof root.studyPack === 'object') {
      root = root.studyPack;
    } else if (root.data && typeof root.data === 'object') {
      root = root.data;
    } else if (root.result && typeof root.result === 'object') {
      root = root.result;
    }

    // 1. Summary
    const rawSummary =
      root.summary ||
      root.overview ||
      root.mainPoints ||
      root.tomTat ||
      root.points ||
      root.content ||
      root.description;

    let summary = '';
    if (typeof rawSummary === 'string') {
      summary = rawSummary.trim();
    } else if (Array.isArray(rawSummary)) {
      summary = rawSummary
        .map((s: any) => (typeof s === 'string' ? s : JSON.stringify(s)))
        .join('\n')
        .trim();
    }

    // 2. Flashcards
    const rawCards = Array.isArray(root.flashcards)
      ? root.flashcards
      : Array.isArray(root.cards)
      ? root.cards
      : Array.isArray(root.flashcard)
      ? root.flashcard
      : Array.isArray(root.items)
      ? root.items
      : Array.isArray(root.vocabulary)
      ? root.vocabulary
      : [];

    const flashcards: { front: string; back: string }[] = [];
    for (const c of rawCards) {
      if (!c || typeof c !== 'object') continue;
      const front = (c.front || c.term || c.question || c.concept || c.key || '').toString().trim();
      const back = (c.back || c.definition || c.answer || c.meaning || c.explanation || c.value || '').toString().trim();
      if (front && back) {
        flashcards.push({
          front: front.slice(0, 1000),
          back: back.slice(0, 1000),
        });
      }
    }

    // 3. Quiz
    const rawQuiz = Array.isArray(root.quiz)
      ? root.quiz
      : Array.isArray(root.questions)
      ? root.questions
      : Array.isArray(root.test)
      ? root.test
      : Array.isArray(root.quizzes)
      ? root.quizzes
      : [];

    const quiz: any[] = [];
    const labels = ['A', 'B', 'C', 'D'];
    const validOptionsSet = new Set(labels);

    for (const q of rawQuiz) {
      if (!q || typeof q !== 'object') continue;
      const questionText = (q.question || q.cauHoi || q.prompt || '').toString().trim();
      if (!questionText) continue;

      let options: { label: string; text: string }[] = [];

      if (Array.isArray(q.options)) {
        if (q.options.length >= 2 && typeof q.options[0] === 'object' && q.options[0] !== null) {
          options = q.options.map((o: any, idx: number) => ({
            label: (o.label || labels[idx] || 'A').toString().toUpperCase().trim().charAt(0),
            text: (o.text || o.content || o.value || '').toString().trim(),
          }));
        } else if (q.options.length >= 2 && typeof q.options[0] === 'string') {
          options = q.options.map((optText: string, idx: number) => ({
            label: labels[idx] || 'A',
            text: optText.replace(/^[A-D][\.\:\)\-]\s*/i, '').trim(),
          }));
        }
      } else if (typeof q.options === 'object' && q.options !== null) {
        for (let i = 0; i < labels.length; i++) {
          const l = labels[i];
          const optVal = q.options[l] || q.options[l.toLowerCase()];
          if (optVal) {
            options.push({
              label: l,
              text: optVal.toString().trim(),
            });
          }
        }
      }

      while (options.length > 0 && options.length < 4) {
        const nextLabel = labels[options.length];
        options.push({
          label: nextLabel,
          text: options.length === 2 ? 'Không có đáp án phù hợp' : 'Cả hai phương án trên đều sai',
        });
      }

      let correctOption = 'A';
      const rawCorrect = (q.correctOption || q.answer || q.correct || q.dapAn || 'A').toString().trim();
      const firstChar = rawCorrect.toUpperCase().charAt(0);
      if (validOptionsSet.has(firstChar)) {
        correctOption = firstChar;
      } else {
        const matchedIndex = options.findIndex(
          (o) => o.text.toLowerCase() === rawCorrect.toLowerCase() || rawCorrect.toLowerCase().includes(o.text.toLowerCase())
        );
        if (matchedIndex !== -1 && labels[matchedIndex]) {
          correctOption = labels[matchedIndex];
        }
      }

      const explanation = (q.explanation || q.reason || q.giaiThich || 'Đáp án chính xác theo tài liệu bài học.').toString().trim();

      if (options.length === 4) {
        quiz.push({
          question: questionText,
          options,
          correctOption,
          explanation,
        });
      }
    }

    if (!summary && flashcards.length > 0) {
      summary = flashcards.map((f) => `• **${f.front}**: ${f.back}`).join('\n');
    }

    if (flashcards.length === 0 && quiz.length > 0) {
      for (const q of quiz) {
        const correctText = q.options.find((o: any) => o.label === q.correctOption)?.text || q.explanation;
        flashcards.push({
          front: q.question,
          back: correctText,
        });
      }
    }

    return { summary, flashcards, quiz };
  },
  z.object({
    summary: z.string().min(5).transform((val) => val.trim()),
    flashcards: z.array(FlashcardItemSchema).min(1),
    quiz: z.array(QuizQuestionSchema).min(1),
  })
);

export type StudyPackType = z.infer<typeof StudyPackSchema>;

// ----------------------------------------------------
// ROBUST JSON EXTRACTOR & PARSER
// ----------------------------------------------------

/**
 * Bóc tách chuỗi JSON hợp lệ kể cả khi AI trả về thừa dấu ngoặc, bọc markdown hoặc có text rác
 */
export function stripMarkdownJson(raw: string): string {
  const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');

  // Nếu chuỗi bắt đầu bằng mảng '['
  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = firstBracket; i < cleaned.length; i++) {
      const char = cleaned[i];
      if (escape) { escape = false; continue; }
      if (char === '\\') { escape = true; continue; }
      if (char === '"') { inString = !inString; continue; }
      if (!inString) {
        if (char === '[') depth++;
        else if (char === ']') {
          depth--;
          if (depth === 0) return cleaned.slice(firstBracket, i + 1);
        }
      }
    }
    const lastBracket = cleaned.lastIndexOf(']');
    if (lastBracket > firstBracket) return cleaned.slice(firstBracket, lastBracket + 1);
    return cleaned;
  }

  // Nếu chuỗi bắt đầu bằng đối tượng '{'
  if (firstBrace !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = firstBrace; i < cleaned.length; i++) {
      const char = cleaned[i];
      if (escape) { escape = false; continue; }
      if (char === '\\') { escape = true; continue; }
      if (char === '"') { inString = !inString; continue; }
      if (!inString) {
        if (char === '{') depth++;
        else if (char === '}') {
          depth--;
          if (depth === 0) return cleaned.slice(firstBrace, i + 1);
        }
      }
    }
    const lastBrace = cleaned.lastIndexOf('}');
    if (lastBrace > firstBrace) return cleaned.slice(firstBrace, lastBrace + 1);
  }

  return cleaned;
}

export const extractValidJson = stripMarkdownJson;

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
    logger.warn('Failed to parse AI raw JSON', { error: String(error), rawPreview: raw.slice(0, 150) });
    return null;
  }
}
