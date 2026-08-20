import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env';
import { sanitizeDiscordOutput } from '../utils/sanitize';
import { logger } from '../utils/logger';
import { ConversationMessage } from './conversationMemory';

const BASE_SYSTEM_PROMPT = `Bạn là Study Buddy — trợ lý học tập thông minh cho sinh viên.
Quy tắc bắt buộc:
1. Luôn trả lời bằng tiếng Việt trừ khi được yêu cầu cụ thể dùng ngôn ngữ khác.
2. Không trả lời các câu hỏi về nội dung bạo lực, kích động, vi phạm pháp luật.
3. Tập trung vào mục tiêu học tập và giáo dục.`;

const AI_TIMEOUT_MS = 25_000;

// Khởi tạo clients
const openaiClient = env.aiApiKey ? new OpenAI({ apiKey: env.aiApiKey }) : null;
const geminiClient = env.aiApiKey ? new GoogleGenAI({ apiKey: env.aiApiKey }) : null;

/**
 * Bóc tách chuỗi JSON hợp lệ kể cả khi AI trả về thừa dấu ngoặc hoặc markdown bao quanh
 */
export function extractValidJson(raw: string): string {
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

async function callAI({
  systemPrompt,
  userMessage,
  history = [],
  maxTokens = 800,
  jsonMode = false,
}: {
  systemPrompt: string;
  userMessage: string;
  history?: ConversationMessage[];
  maxTokens?: number;
  jsonMode?: boolean;
}): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    let answer = '';

    if (env.aiProvider === 'gemini' && geminiClient) {
      let contents: any;
      if (history.length > 0) {
        contents = [
          ...history.map((m) => ({
            role: m.role,
            parts: [{ text: m.content }],
          })),
          { role: 'user', parts: [{ text: userMessage }] },
        ];
      } else {
        contents = userMessage;
      }

      const response = await geminiClient.models.generateContent({
        model: env.aiModel || 'gemini-3.5-flash',
        contents,
        config: {
          systemInstruction: systemPrompt,
          maxOutputTokens: Math.max(maxTokens, 2048),
          responseMimeType: jsonMode ? 'application/json' : 'text/plain',
        },
      });
      answer = response.text || '';
    } else if (openaiClient) {
      const messages: any[] = [{ role: 'system', content: systemPrompt }];
      for (const h of history) {
        messages.push({
          role: h.role === 'model' ? 'assistant' : 'user',
          content: h.content,
        });
      }
      messages.push({ role: 'user', content: userMessage });

      const response = await openaiClient.chat.completions.create(
        {
          model: env.aiModel || 'gpt-4o-mini',
          messages,
          max_tokens: maxTokens,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        },
        { signal: controller.signal }
      );
      answer = response.choices[0]?.message?.content ?? '';
    } else {
      answer = '⚠️ Chưa cấu hình AI API Key hợp lệ trong .env.';
    }

    return sanitizeDiscordOutput(answer || 'Không có phản hồi từ AI.');
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error('AI_TIMEOUT');
    }
    logger.error('AI API Error', { provider: env.aiProvider, model: env.aiModel, error: String(error) });
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function askAI(userQuestion: string): Promise<string> {
  return callAI({
    systemPrompt: `${BASE_SYSTEM_PROMPT}\n4. Giữ câu trả lời ngắn gọn, súc tích, tối đa 1500 ký tự.`,
    userMessage: userQuestion,
    maxTokens: 600,
  });
}

export async function askAIWithContext(
  userQuestion: string,
  history: ConversationMessage[]
): Promise<string> {
  return callAI({
    systemPrompt: `${BASE_SYSTEM_PROMPT}\n4. Bạn đang trò chuyện tiếp nối với sinh viên. Hãy dựa vào ngữ cảnh các tin nhắn trước để trả lời chính xác, gắn kết. Tối đa 1500 ký tự.`,
    userMessage: userQuestion,
    history,
    maxTokens: 800,
  });
}

export async function summarizeText(text: string): Promise<string> {
  return callAI({
    systemPrompt: `${BASE_SYSTEM_PROMPT}\n4. Tóm tắt thành 3-5 điểm chính dạng bullet points (•). Tối đa 800 ký tự.`,
    userMessage: `Tóm tắt văn bản sau:\n\n${text}`,
    maxTokens: 400,
  });
}

export async function generateQuizJson(topic: string, questionCount: number): Promise<string> {
  return callAI({
    systemPrompt: `${BASE_SYSTEM_PROMPT}\n4. Trả về JSON theo định dạng bắt buộc:
{"questions": [{"question": "...", "options": [{"label": "A", "text": "..."}, {"label": "B", "text": "..."}, {"label": "C", "text": "..."}, {"label": "D", "text": "..."}], "correctOption": "A", "explanation": "..."}]}`,
    userMessage: `Tạo ${questionCount} câu hỏi trắc nghiệm về chủ đề: ${topic}`,
    maxTokens: 250 * questionCount,
    jsonMode: true,
  });
}

export interface QuizQuestionData {
  question: string;
  options: { label: string; text: string }[];
  correctOption: 'A' | 'B' | 'C' | 'D';
  explanation: string;
}

const VALID_OPTIONS = new Set(['A', 'B', 'C', 'D']);

export function parseAIJsonResponse(raw: string): QuizQuestionData[] | null {
  try {
    const jsonStr = extractValidJson(raw);
    const parsed = JSON.parse(jsonStr);
    const list = Array.isArray(parsed) ? parsed : parsed.questions;

    if (!Array.isArray(list)) return null;

    const valid: QuizQuestionData[] = [];
    for (const q of list) {
      if (!q || typeof q.question !== 'string') continue;

      let options: { label: string; text: string }[] = [];
      if (Array.isArray(q.options)) {
        if (q.options.length === 4 && typeof q.options[0] === 'object' && q.options[0]?.label) {
          options = q.options.map((o: any) => ({
            label: o.label.toString().toUpperCase().trim(),
            text: o.text.toString().trim(),
          }));
        } else if (q.options.length === 4 && typeof q.options[0] === 'string') {
          const labels = ['A', 'B', 'C', 'D'];
          options = q.options.map((optText: string, idx: number) => ({
            label: labels[idx],
            text: optText.replace(/^[A-D][\.\:\)\-]\s*/i, '').trim(),
          }));
        }
      }

      const rawCorrect = (q.correctOption || 'A').toString().trim().toUpperCase();
      const firstChar = rawCorrect.charAt(0);
      const correctOption = VALID_OPTIONS.has(firstChar) ? (firstChar as 'A' | 'B' | 'C' | 'D') : 'A';
      const explanation = (q.explanation || 'Đáp án đúng theo bài học.').toString().trim();

      if (options.length === 4) {
        valid.push({
          question: q.question.trim(),
          options,
          correctOption,
          explanation,
        });
      }
    }

    return valid.length > 0 ? valid : null;
  } catch {
    return null;
  }
}

export async function generateFlashcardsJson(topic: string, count: number): Promise<string> {
  return callAI({
    systemPrompt: `${BASE_SYSTEM_PROMPT}\n4. Bạn là chuyên gia tạo Flashcard học tập. Hãy tạo các thẻ học ghi nhớ chất lượng cao.
5. Trả về JSON theo định dạng bắt buộc:
{"flashcards": [{"front": "Khái niệm / Câu hỏi / Từ vựng ngắn gọn (mặt trước)", "back": "Định nghĩa / Giải nghĩa / Ví dụ chi tiết (mặt sau)"}]}`,
    userMessage: `Tạo ${count} flashcard học tập chất lượng cao về chủ đề: ${topic}`,
    maxTokens: 300 * count,
    jsonMode: true,
  });
}

export interface FlashcardItemData {
  front: string;
  back: string;
}

export function parseFlashcardAIResponse(raw: string): FlashcardItemData[] | null {
  try {
    const jsonStr = extractValidJson(raw);
    const parsed = JSON.parse(jsonStr);
    const list = Array.isArray(parsed) ? parsed : parsed.flashcards;

    if (!Array.isArray(list) || list.length === 0) return null;

    const valid: FlashcardItemData[] = [];
    for (const item of list) {
      const front = (item.front || item.term || item.question || '').toString().trim();
      const back = (item.back || item.definition || item.answer || '').toString().trim();
      if (front && back && front.length <= 1000 && back.length <= 1000) {
        valid.push({ front, back });
      }
    }

    return valid.length > 0 ? valid : null;
  } catch {
    return null;
  }
}

// ----------------------------------------------------
// 📑 AI DOCUMENT STUDY PACK GENERATOR (/tailieu)
// ----------------------------------------------------

export interface StudyPackData {
  summary: string;
  flashcards: FlashcardItemData[];
  quiz: QuizQuestionData[];
}

export async function generateStudyPackJson(documentContent: string): Promise<string> {
  return callAI({
    systemPrompt: `${BASE_SYSTEM_PROMPT}
4. Bạn là cố vấn học tập cao cấp. Hãy phân tích kỹ tài liệu bài giảng được cung cấp và trích xuất trọn bộ tài liệu ôn tập Study Pack.
5. Trả về DUY NHẤT một chuỗi JSON hợp lệ theo cấu trúc:
{
  "summary": "Tóm tắt 3-4 điểm chính cốt lõi nhất của tài liệu dạng gạch đầu dòng (•)",
  "flashcards": [
    {"front": "Thuật ngữ / Khái niệm / Câu hỏi chính (mặt trước)", "back": "Định nghĩa / Giải thích ngắn gọn (mặt sau)"}
  ],
  "quiz": [
    {
      "question": "Câu hỏi trắc nghiệm kiểm tra độ hiểu bài",
      "options": [{"label": "A", "text": "..."}, {"label": "B", "text": "..."}, {"label": "C", "text": "..."}, {"label": "D", "text": "..."}],
      "correctOption": "A",
      "explanation": "Lời giải thích ngắn gọn vì sao đáp án đúng"
    }
  ]
}`,
    userMessage: `Phân tích tài liệu học tập sau và tạo trọn bộ Study Pack (3-5 flashcards, 2-3 câu hỏi trắc nghiệm):\n\n${documentContent}`,
    maxTokens: 4096,
    jsonMode: true,
  });
}

export function parseStudyPackResponse(raw: string): StudyPackData | null {
  try {
    const jsonStr = extractValidJson(raw);
    const parsed = JSON.parse(jsonStr);

    if (!parsed) return null;

    // 🛡️ 1. Mở bọc (Unwrap) nếu AI gói đối tượng trong mảng hoặc key cha (studyPack, data, result)
    let root = parsed;
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

    // 🛡️ 2. Chuẩn hóa Summary (hỗ trợ nhiều tên biến và mảng chuỗi)
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

    // 🛡️ 3. Chuẩn hóa Flashcards (hỗ trợ cards, deck, vocabulary, term/definition, question/answer)
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

    const flashcards: FlashcardItemData[] = [];
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

    // 🛡️ 4. Chuẩn hóa Quiz (hỗ trợ questions, test, quizzes, 2-4 options, object options, string options)
    const rawQuiz = Array.isArray(root.quiz)
      ? root.quiz
      : Array.isArray(root.questions)
      ? root.questions
      : Array.isArray(root.test)
      ? root.test
      : Array.isArray(root.quizzes)
      ? root.quizzes
      : [];

    const quiz: QuizQuestionData[] = [];
    const labels = ['A', 'B', 'C', 'D'];

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
          const val = q.options[l] || q.options[l.toLowerCase()];
          if (val) {
            options.push({
              label: l,
              text: val.toString().trim(),
            });
          }
        }
      }

      // Nếu có 2 hoặc 3 options (ví dụ câu hỏi Đúng/Sai), tự động bổ sung thành 4 options chuẩn Discord
      while (options.length > 0 && options.length < 4) {
        const nextLabel = labels[options.length];
        options.push({
          label: nextLabel,
          text: options.length === 2 ? 'Không có đáp án phù hợp' : 'Cả hai phương án trên đều sai',
        });
      }

      // Xác định correctOption
      let correctOption: 'A' | 'B' | 'C' | 'D' = 'A';
      const rawCorrect = (q.correctOption || q.answer || q.correct || q.dapAn || 'A').toString().trim();

      const firstChar = rawCorrect.toUpperCase().charAt(0);
      if (VALID_OPTIONS.has(firstChar)) {
        correctOption = firstChar as 'A' | 'B' | 'C' | 'D';
      } else {
        const matchedIndex = options.findIndex(
          (o) => o.text.toLowerCase() === rawCorrect.toLowerCase() || rawCorrect.toLowerCase().includes(o.text.toLowerCase())
        );
        if (matchedIndex !== -1 && labels[matchedIndex]) {
          correctOption = labels[matchedIndex] as 'A' | 'B' | 'C' | 'D';
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

    // Nếu summary bị thiếu, tự sinh tóm tắt từ flashcards
    if (!summary && flashcards.length > 0) {
      summary = flashcards.map((f) => `• **${f.front}**: ${f.back}`).join('\n');
    }

    // Nếu flashcards bị thiếu nhưng có quiz, tự sinh flashcard từ quiz
    if (flashcards.length === 0 && quiz.length > 0) {
      for (const q of quiz) {
        const correctText = q.options.find((o) => o.label === q.correctOption)?.text || q.explanation;
        flashcards.push({
          front: q.question,
          back: correctText,
        });
      }
    }

    if (!summary || (flashcards.length === 0 && quiz.length === 0)) {
      return null;
    }

    return {
      summary,
      flashcards,
      quiz,
    };
  } catch (error) {
    logger.warn('Failed to parse study pack JSON', { error: String(error) });
    return null;
  }
}
