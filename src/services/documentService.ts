import { prisma } from '../config/prisma';
import { generateStudyPackJson, parseStudyPackResponse, StudyPackData, QuizQuestionData } from './aiService';
import { recordDbAiUsage } from './dbRateLimiter';
import { recordUserActivity } from './streakService';
import { isPrintableText, sanitizeUnicodeInput } from '../utils/sanitize';
import { logger } from '../utils/logger';

const MAX_DOCUMENT_CHARS = 12_000;
const ALLOWED_EXTENSIONS = ['.txt', '.md', '.json', '.csv'];
const FETCH_TIMEOUT_MS = 10_000;

// 🛡️ Prompt-injection heuristics: chặn các mẫu câu cố gắng override instructions / lộ system prompt
// Chuẩn hóa trước khi check: gỡ zero-width/format chars (\p{Cf}) để chống obfuscation
function normalizeForInjectionCheck(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\p{Cf}/gu, ' ')
    .replace(/\s+/g, ' ');
}

const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  // English: override-instruction attempts
  /ignore\s+(all\s+|any\s+|the\s+)?(previous\s+|prior\s+)?instructions/i,
  /(disregard|forget)\s+(all\s+|any\s+|the\s+)?(previous\s+|prior\s+)?instructions/i,
  // English: exfiltrate system prompt
  /(reveal|output|show|print)\s+(your\s+|the\s+)?(hidden\s+)?system\s+prompt/i,
  // Vietnamese: override-instruction
  /bỏ\s+qua\s+(mọi|toàn\s+bộ|tất\s+cả|những)?\s*(hướng\s+dẫn|chỉ\s+thị|chỉ\s+dẫn|yêu\s+cầu)\s+trước/i,
  // Vietnamese: exfiltrate system prompt
  /(tiết\s+lộ|hé\s+lộ|in\s+ra|xuất)\s+(system\s+prompt|prompt\s+hệ\s+thống)/i,
];

export interface ExtractedDocumentResult {
  text: string;
  truncated: boolean;
  sourceType: 'text' | 'file';
}

/**
 * Trích xuất và thẩm định an toàn nội dung từ văn bản dán trực tiếp hoặc file đính kèm
 */
export async function extractDocumentContent(
  directText?: string | null,
  attachmentUrl?: string | null,
  attachmentName?: string | null,
  attachmentSize?: number | null
): Promise<ExtractedDocumentResult> {
  let rawText = '';
  let sourceType: 'text' | 'file' = 'text';

  // 1. Kiểm tra nếu có file đính kèm
  if (attachmentUrl && attachmentName) {
    sourceType = 'file';

    // 🛡️ Kiểm tra kích thước file (tối đa 1MB)
    if (attachmentSize && attachmentSize > 1024 * 1024) {
      throw new Error('FILE_TOO_LARGE');
    }

    // 🛡️ Kiểm tra định dạng file allowlist
    const lowerName = attachmentName.toLowerCase();
    const isAllowed = ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
    if (!isAllowed) {
      throw new Error('INVALID_FILE_TYPE');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(attachmentUrl, { signal: controller.signal });
      if (!response.ok) {
        throw new Error('FETCH_FAILED');
      }
      rawText = await response.text();
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('FETCH_TIMEOUT');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  } else if (directText && directText.trim().length > 0) {
    rawText = directText.trim();
  } else {
    throw new Error('EMPTY_INPUT');
  }

  // 🛡️ Kiểm tra chống file nhị phân giả mạo / null bytes
  if (!isPrintableText(rawText)) {
    throw new Error('INVALID_BINARY_CONTENT');
  }

  // 🛡️ Chặn prompt-injection trước khi nội dung được đưa vào LLM prompt
  const normalizedText = normalizeForInjectionCheck(rawText);
  if (PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(normalizedText))) {
    throw new Error('PROMPT_INJECTION_DETECTED');
  }

  if (rawText.trim().length < 50) {
    throw new Error('CONTENT_TOO_SHORT');
  }

  // 🛡️ Cắt gọt an toàn tối đa 12.000 ký tự đầu tiên
  const truncated = rawText.length > MAX_DOCUMENT_CHARS;
  const safeText = truncated ? rawText.slice(0, MAX_DOCUMENT_CHARS) : rawText;

  return {
    text: safeText,
    truncated,
    sourceType,
  };
}

export interface IngestionResult {
  summary: string;
  flashcardCount: number;
  quizCount: number;
  deckName: string;
  isAppended: boolean;
  sampleQuiz: QuizQuestionData | null;
}

/**
 * Xử lý tạo Study Pack từ nội dung tài liệu và lưu thẳng vào CSDL
 */
export async function processStudyPackIngestion(
  userId: string,
  discordUserId: string,
  username: string,
  guildId: string | null,
  deckName: string,
  documentContent: string
): Promise<IngestionResult> {
  const cleanDeckName = sanitizeUnicodeInput(deckName);

  // 1. Gọi AI sinh Study Pack dạng JSON
  const rawAiJson = await generateStudyPackJson(documentContent);
  const studyPack: StudyPackData | null = parseStudyPackResponse(rawAiJson);

  if (!studyPack) {
    throw new Error('AI_PARSING_FAILED');
  }

  // 2. Lưu trữ CSDL thông minh (Smart Upsert & Append)
  let isAppended = false;

  await prisma.$transaction(async (tx) => {
    // Kiểm tra bộ thẻ đã tồn tại chưa
    const existingDeck = await tx.flashcardDeck.findUnique({
      where: { userId_name: { userId, name: cleanDeckName } },
    });

    let targetDeckId: string;

    if (existingDeck) {
      targetDeckId = existingDeck.id;
      isAppended = true;
    } else {
      const newDeck = await tx.flashcardDeck.create({
        data: {
          userId,
          guildId,
          name: cleanDeckName,
          description: `Tạo tự động từ tài liệu học tập bởi Study Buddy AI`,
        },
      });
      targetDeckId = newDeck.id;
    }

    // Nạp toàn bộ Flashcard mới vào CSDL với trạng thái SM-2 ban đầu
    const cardsToInsert = studyPack.flashcards.map((card) => ({
      deckId: targetDeckId,
      front: card.front,
      back: card.back,
      repetition: 0,
      interval: 1,
      easeFactor: 2.5,
      nextReviewAt: new Date(),
    }));

    await tx.flashcard.createMany({
      data: cardsToInsert,
    });
  });

  // 3. Ghi nhận hoạt động học tập & trừ hạn mức
  await recordUserActivity(discordUserId, username).catch((err) => {
    logger.warn('Failed to update streak in study pack ingestion', { err: String(err) });
  });

  await recordDbAiUsage(userId, 'AI_DOCUMENT_STUDY').catch((err) => {
    logger.warn('Failed to record AI usage log', { err: String(err) });
  });

  return {
    summary: studyPack.summary,
    flashcardCount: studyPack.flashcards.length,
    quizCount: studyPack.quiz.length,
    deckName: cleanDeckName,
    isAppended,
    sampleQuiz: studyPack.quiz[0] || null,
  };
}
