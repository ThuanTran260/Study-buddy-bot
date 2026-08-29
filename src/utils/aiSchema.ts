import { z } from 'zod';
import { logger } from './logger';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Coerce an toàn unknown -> string, chỉ nhận primitive text.
 * Chặn "[object Object]" lọt vào nội dung học tập từ payload AI rác.
 */
const asText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
};

// ----------------------------------------------------
// QUIZ SCHEMA
// ----------------------------------------------------

export const QuizOptionSchema = z.object({
  label: z.string().transform((val) => val.trim().toUpperCase().charAt(0)), // A, B, C, D
  text: z
    .string()
    .min(1)
    .transform((val) => val.trim()),
});

export const QuizQuestionSchema = z.object({
  question: z
    .string()
    .min(1)
    .transform((val) => val.trim()),
  options: z.array(QuizOptionSchema).length(4, { message: 'Must have exactly 4 options' }),
  correctOption: z.enum(['A', 'B', 'C', 'D']),
  explanation: z
    .string()
    .default('Đáp án chính xác theo tài liệu bài học.')
    .transform((val) => val.trim()),
});

export const QuizResponseSchema = z.preprocess(
  (val: unknown) => {
    if (!val) return val;
    const arr: unknown[] = Array.isArray(val) ? val : [];
    const firstElement = arr.length > 0 ? arr[0] : undefined;
    const root =
      firstElement !== undefined && isRecord(firstElement) && !firstElement.question
        ? firstElement
        : val;
    const rootRec: Record<string, unknown> = isRecord(root) ? root : {};
    const rawQuestions = Array.isArray(root)
      ? root
      : rootRec.questions || rootRec.quiz || rootRec.test || rootRec.quizzes || [];

    if (!Array.isArray(rawQuestions)) return { questions: [] };

    const labels = ['A', 'B', 'C', 'D'];
    const validOptionsSet = new Set(labels);

    const questions = rawQuestions.map((q: unknown) => {
      if (!q || typeof q !== 'object') return q;
      const rec = q as Record<string, unknown>;
      const questionText = (
        asText(rec.question) ||
        asText(rec.cauHoi) ||
        asText(rec.prompt)
      ).trim();

      let options: { label: string; text: string }[] = [];
      if (Array.isArray(rec.options)) {
        if (
          rec.options.length >= 2 &&
          typeof rec.options[0] === 'object' &&
          rec.options[0] !== null
        ) {
          options = rec.options.map((o: unknown, idx: number) => {
            const opt = o as Record<string, unknown>;
            return {
              label: (asText(opt.label) || labels[idx] || 'A').toUpperCase().trim().charAt(0),
              text: (asText(opt.text) || asText(opt.content) || asText(opt.value)).trim(),
            };
          });
        } else if (rec.options.length >= 2 && typeof rec.options[0] === 'string') {
          options = rec.options.map((optText: string, idx: number) => ({
            label: labels[idx] || 'A',
            text: optText.replace(/^[A-D][.:)-]\s*/i, '').trim(),
          }));
        }
      } else if (typeof rec.options === 'object' && rec.options !== null) {
        const optObj = rec.options as Record<string, unknown>;
        for (let i = 0; i < labels.length; i++) {
          const l = labels[i];
          const optVal = optObj[l] || optObj[l.toLowerCase()];
          if (optVal) {
            options.push({ label: l, text: asText(optVal).trim() });
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
      const rawCorrect = (
        asText(rec.correctOption) ||
        asText(rec.answer) ||
        asText(rec.correct) ||
        asText(rec.dapAn) ||
        'A'
      ).trim();
      const firstChar = rawCorrect.toUpperCase().charAt(0);
      if (validOptionsSet.has(firstChar)) {
        correctOption = firstChar;
      } else {
        const matchedIndex = options.findIndex(
          (o) =>
            o.text.toLowerCase() === rawCorrect.toLowerCase() ||
            rawCorrect.toLowerCase().includes(o.text.toLowerCase())
        );
        if (matchedIndex !== -1 && labels[matchedIndex]) {
          correctOption = labels[matchedIndex];
        }
      }

      const explanation = (
        asText(rec.explanation) ||
        asText(rec.reason) ||
        asText(rec.giaiThich) ||
        'Đáp án chính xác theo tài liệu bài học.'
      ).trim();

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
  front: z
    .string()
    .min(1)
    .max(1000)
    .transform((val) => val.trim()),
  back: z
    .string()
    .min(1)
    .max(1000)
    .transform((val) => val.trim()),
});

export const FlashcardResponseSchema = z.preprocess(
  (val: unknown) => {
    if (!val) return val;
    const arr: unknown[] = Array.isArray(val) ? val : [];
    const firstElement = arr.length > 0 ? arr[0] : undefined;
    const root =
      firstElement !== undefined && isRecord(firstElement) && !firstElement.front
        ? firstElement
        : val;
    const rootRec: Record<string, unknown> = isRecord(root) ? root : {};
    const rawCards = Array.isArray(root)
      ? root
      : rootRec.flashcards || rootRec.cards || rootRec.vocabulary || rootRec.items || [];

    if (!Array.isArray(rawCards)) return { flashcards: [] };

    const flashcards = rawCards.map((c: unknown) => {
      if (!c || typeof c !== 'object') return c;
      const card = c as Record<string, unknown>;
      const front = (
        asText(card.front) ||
        asText(card.term) ||
        asText(card.question) ||
        asText(card.concept) ||
        asText(card.key)
      ).trim();
      const back = (
        asText(card.back) ||
        asText(card.definition) ||
        asText(card.answer) ||
        asText(card.meaning) ||
        asText(card.explanation) ||
        asText(card.value)
      ).trim();
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
  (val: unknown) => {
    if (!val || typeof val !== 'object') return val;

    let root = val as Record<string, unknown>;
    if (Array.isArray(root) && root.length > 0 && typeof root[0] === 'object') {
      root = root[0] as Record<string, unknown>;
    }
    if (root.studyPack && typeof root.studyPack === 'object') {
      root = root.studyPack as Record<string, unknown>;
    } else if (root.data && typeof root.data === 'object') {
      root = root.data as Record<string, unknown>;
    } else if (root.result && typeof root.result === 'object') {
      root = root.result as Record<string, unknown>;
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
        .map((s: unknown) => (typeof s === 'string' ? s : JSON.stringify(s)))
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
      if (!isRecord(c)) continue;
      const front = (
        asText(c.front) ||
        asText(c.term) ||
        asText(c.question) ||
        asText(c.concept) ||
        asText(c.key)
      ).trim();
      const back = (
        asText(c.back) ||
        asText(c.definition) ||
        asText(c.answer) ||
        asText(c.meaning) ||
        asText(c.explanation) ||
        asText(c.value)
      ).trim();
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

    const quiz: Record<string, unknown>[] = [];
    const labels = ['A', 'B', 'C', 'D'];
    const validOptionsSet = new Set(labels);

    for (const q of rawQuiz) {
      if (!isRecord(q)) continue;
      const questionText = (asText(q.question) || asText(q.cauHoi) || asText(q.prompt)).trim();
      if (!questionText) continue;

      let options: { label: string; text: string }[] = [];

      if (Array.isArray(q.options)) {
        if (q.options.length >= 2 && typeof q.options[0] === 'object' && q.options[0] !== null) {
          options = q.options.map((o: unknown, idx: number) => {
            const opt = o as Record<string, unknown>;
            return {
              label: (asText(opt.label) || labels[idx] || 'A').toUpperCase().trim().charAt(0),
              text: (asText(opt.text) || asText(opt.content) || asText(opt.value)).trim(),
            };
          });
        } else if (q.options.length >= 2 && typeof q.options[0] === 'string') {
          options = q.options.map((optText: string, idx: number) => ({
            label: labels[idx] || 'A',
            text: optText.replace(/^[A-D][.:)-]\s*/i, '').trim(),
          }));
        }
      } else if (typeof q.options === 'object' && q.options !== null) {
        const optObj = q.options as Record<string, unknown>;
        for (let i = 0; i < labels.length; i++) {
          const l = labels[i];
          const optVal = optObj[l] || optObj[l.toLowerCase()];
          if (optVal) {
            options.push({
              label: l,
              text: asText(optVal).trim(),
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
      const rawCorrect = (
        asText(q.correctOption) ||
        asText(q.answer) ||
        asText(q.correct) ||
        asText(q.dapAn) ||
        'A'
      ).trim();
      const firstChar = rawCorrect.toUpperCase().charAt(0);
      if (validOptionsSet.has(firstChar)) {
        correctOption = firstChar;
      } else {
        const matchedIndex = options.findIndex(
          (o) =>
            o.text.toLowerCase() === rawCorrect.toLowerCase() ||
            rawCorrect.toLowerCase().includes(o.text.toLowerCase())
        );
        if (matchedIndex !== -1 && labels[matchedIndex]) {
          correctOption = labels[matchedIndex];
        }
      }

      const explanation = (
        asText(q.explanation) ||
        asText(q.reason) ||
        asText(q.giaiThich) ||
        'Đáp án chính xác theo tài liệu bài học.'
      ).trim();

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
        const correctText =
          (q.options as { label?: unknown; text?: unknown }[]).find(
            (o) => o.label === q.correctOption
          )?.text || q.explanation;
        flashcards.push({
          front: q.question as string,
          back: correctText as string,
        });
      }
    }

    return { summary, flashcards, quiz };
  },
  z.object({
    summary: z
      .string()
      .min(5)
      .transform((val) => val.trim()),
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
  const cleaned = raw
    .replace(/^```json?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');

  // Nếu chuỗi bắt đầu bằng mảng '['
  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = firstBracket; i < cleaned.length; i++) {
      const char = cleaned[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
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
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
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
export function safeParseAIJson<T>(raw: string, schema: z.ZodType<T>): T | null {
  try {
    const stripped = stripMarkdownJson(raw);
    const parsedObj = JSON.parse(stripped) as unknown;

    // Validate bằng Zod
    const result = schema.safeParse(parsedObj);
    if (!result.success) {
      logger.warn('Zod validation failed for AI JSON', {
        errors: result.error.errors,
        rawPreview: raw.slice(0, 150),
      });
      return null;
    }

    return result.data;
  } catch (error) {
    logger.warn('Failed to parse AI raw JSON', {
      error: String(error),
      rawPreview: raw.slice(0, 150),
    });
    return null;
  }
}

// ----------------------------------------------------
// MULTI-MODAL VISUAL RESPONSE SCHEMA
// ----------------------------------------------------

export const VisualResponseSchema = z.preprocess(
  (val: unknown) => {
    if (!val || typeof val !== 'object') return val;
    let root = val as Record<string, unknown>;
    if (Array.isArray(root) && root.length > 0 && typeof root[0] === 'object') {
      root = root[0] as Record<string, unknown>;
    }

    const textAnswer =
      root.textAnswer || root.answer || root.text || root.explanation || root.content || '';
    const hasVisual = Boolean(
      root.hasVisual ||
      root.visual ||
      root.needsVisual ||
      root.diagram ||
      root.hasDiagram ||
      root.isDiagram ||
      root.visualType === 'mermaid' ||
      root.visualType === 'diagram' ||
      root.visualType === 'image' ||
      root.visualType === 'illustration'
    );
    const visualType =
      root.visualType === 'mermaid' || root.visualType === 'diagram'
        ? 'mermaid'
        : root.visualType === 'image' || root.visualType === 'illustration'
          ? 'image'
          : undefined;

    const visualPromptOrCode =
      root.visualPromptOrCode ||
      root.code ||
      root.mermaid ||
      root.prompt ||
      root.mermaidCode ||
      undefined;

    return {
      textAnswer: typeof textAnswer === 'string' ? textAnswer.trim() : JSON.stringify(textAnswer),
      hasVisual,
      visualType,
      visualPromptOrCode:
        typeof visualPromptOrCode === 'string' ? visualPromptOrCode.trim() : undefined,
    };
  },
  z.object({
    textAnswer: z.string().min(1),
    hasVisual: z.boolean().default(false),
    visualType: z.enum(['mermaid', 'image']).optional(),
    visualPromptOrCode: z.string().optional(),
  })
);

export type VisualResponseType = z.infer<typeof VisualResponseSchema>;
