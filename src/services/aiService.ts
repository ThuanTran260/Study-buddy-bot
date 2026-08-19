import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env';
import { sanitizeDiscordOutput } from '../utils/sanitize';
import { logger } from '../utils/logger';

const BASE_SYSTEM_PROMPT = `Bạn là Study Buddy — trợ lý học tập thông minh cho sinh viên.
Quy tắc bắt buộc:
1. Luôn trả lời bằng tiếng Việt trừ khi được yêu cầu cụ thể dùng ngôn ngữ khác.
2. Không trả lời các câu hỏi về nội dung bạo lực, kích động, vi phạm pháp luật.
3. Tập trung vào mục tiêu học tập và giáo dục.`;

const AI_TIMEOUT_MS = 15_000;

// Khởi tạo clients
const openaiClient = env.aiApiKey ? new OpenAI({ apiKey: env.aiApiKey }) : null;
const geminiClient = env.aiApiKey ? new GoogleGenAI({ apiKey: env.aiApiKey }) : null;

async function callAI({
  systemPrompt,
  userMessage,
  maxTokens = 800,
  jsonMode = false,
}: {
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  jsonMode?: boolean;
}): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    let answer = '';

    if (env.aiProvider === 'gemini' && geminiClient) {
      // Gọi Google Gemini API (Miễn phí)
      const response = await geminiClient.models.generateContent({
        model: env.aiModel || 'gemini-3.6-flash',
        contents: userMessage,
        config: {
          systemInstruction: systemPrompt,
          maxOutputTokens: Math.max(maxTokens, 2048),
          responseMimeType: jsonMode ? 'application/json' : 'text/plain',
        },
      });
      answer = response.text || '';
    } else if (openaiClient) {
      // Gọi OpenAI API
      const response = await openaiClient.chat.completions.create(
        {
          model: env.aiModel || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
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
    logger.error('AI API Error', { provider: env.aiProvider, error: String(error) });
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
    const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    const list = Array.isArray(parsed) ? parsed : parsed.questions;

    if (!Array.isArray(list)) return null;

    const valid = list.every(
      (q) =>
        typeof q.question === 'string' &&
        Array.isArray(q.options) &&
        q.options.length === 4 &&
        VALID_OPTIONS.has(q.correctOption) &&
        typeof q.explanation === 'string'
    );
    return valid ? (list as QuizQuestionData[]) : null;
  } catch {
    return null;
  }
}
