import {
  extractDocumentContent,
  processStudyPackIngestion,
} from '../../src/services/documentService';
import { parseStudyPackResponse } from '../../src/services/aiService';
import { prisma } from '../../src/config/prisma';

jest.mock('../../src/config/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    flashcardDeck: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    flashcard: {
      createMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    aiUsageLog: {
      create: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
  },
}));

jest.mock('../../src/services/aiService', () => {
  const original = jest.requireActual('../../src/services/aiService');
  return {
    ...original,
    generateStudyPackJson: jest.fn().mockResolvedValue(
      JSON.stringify({
        summary: '• Điểm 1\n• Điểm 2\n• Điểm 3',
        flashcards: [
          { front: 'Khái niệm A', back: 'Định nghĩa A' },
          { front: 'Khái niệm B', back: 'Định nghĩa B' },
        ],
        quiz: [
          {
            question: 'Câu hỏi 1?',
            options: [
              { label: 'A', text: 'Đáp án A' },
              { label: 'B', text: 'Đáp án B' },
              { label: 'C', text: 'Đáp án C' },
              { label: 'D', text: 'Đáp án D' },
            ],
            correctOption: 'A',
            explanation: 'Vì A đúng',
          },
        ],
      })
    ),
  };
});

describe('documentService', () => {
  describe('extractDocumentContent', () => {
    it('throws EMPTY_INPUT when both direct text and file are absent', async () => {
      await expect(extractDocumentContent(null, null, null, null)).rejects.toThrow('EMPTY_INPUT');
    });

    it('throws CONTENT_TOO_SHORT when text has less than 50 characters', async () => {
      await expect(extractDocumentContent('Ngắn quá', null, null, null)).rejects.toThrow('CONTENT_TOO_SHORT');
    });

    it('accepts valid direct text and extracts correctly', async () => {
      const validText = 'Đây là một đoạn văn bản tài liệu học tập đầy đủ dài hơn 50 ký tự để kiểm tra tính năng trích xuất bài giảng.';
      const result = await extractDocumentContent(validText, null, null, null);
      expect(result.text).toBe(validText);
      expect(result.truncated).toBe(false);
      expect(result.sourceType).toBe('text');
    });

    it('rejects forbidden file extensions like .exe or .png', async () => {
      await expect(
        extractDocumentContent(null, 'https://example.com/bad.exe', 'bad.exe', 500)
      ).rejects.toThrow('INVALID_FILE_TYPE');
    });

    it('rejects file larger than 1MB', async () => {
      await expect(
        extractDocumentContent(null, 'https://example.com/large.txt', 'large.txt', 2 * 1024 * 1024)
      ).rejects.toThrow('FILE_TOO_LARGE');
    });

    it('truncates document text exceeding 12,000 characters safely', async () => {
      const longText = 'A'.repeat(15_000);
      const result = await extractDocumentContent(longText, null, null, null);
      expect(result.text.length).toBe(12_000);
      expect(result.truncated).toBe(true);
    });
  });

  describe('parseStudyPackResponse', () => {
    it('parses valid study pack json accurately', () => {
      const sampleJson = JSON.stringify({
        summary: '• Tóm tắt bài học',
        flashcards: [{ front: 'F1', back: 'B1' }],
        quiz: [
          {
            question: 'Q1',
            options: [
              { label: 'A', text: '1' },
              { label: 'B', text: '2' },
              { label: 'C', text: '3' },
              { label: 'D', text: '4' },
            ],
            correctOption: 'A',
            explanation: 'Expl',
          },
        ],
      });

      const parsed = parseStudyPackResponse(sampleJson);
      expect(parsed).not.toBeNull();
      expect(parsed?.flashcards.length).toBe(1);
      expect(parsed?.quiz.length).toBe(1);
    });

    it('returns null on invalid or missing fields', () => {
      expect(parseStudyPackResponse('invalid json')).toBeNull();
      expect(parseStudyPackResponse(JSON.stringify({ summary: 'only summary' }))).toBeNull();
    });
  });

  describe('processStudyPackIngestion', () => {
    it('creates new deck and bulk creates flashcards in transaction', async () => {
      const mockTx = {
        flashcardDeck: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'new-deck-id' }),
        },
        flashcard: {
          createMany: jest.fn().mockResolvedValue({ count: 2 }),
        },
      };

      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (callback) => {
        return callback(mockTx);
      });

      const result = await processStudyPackIngestion(
        'user-uuid',
        'discord-123',
        'ThuanTran',
        'guild-123',
        'Bài Học 1',
        'Nội dung bài học dài hơn 50 ký tự để kiểm tra tính năng trích xuất bài giảng...'
      );

      expect(result.deckName).toBe('Bài Học 1');
      expect(result.flashcardCount).toBe(2);
      expect(result.isAppended).toBe(false);
      expect(mockTx.flashcardDeck.create).toHaveBeenCalled();
      expect(mockTx.flashcard.createMany).toHaveBeenCalled();
    });
  });
});
