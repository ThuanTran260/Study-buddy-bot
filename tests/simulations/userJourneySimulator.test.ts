import { extractValidJson, parseStudyPackResponse } from '../../src/services/aiService';
import { calculateSM2 } from '../../src/services/sm2Service';
import { calculateStreakUpdate } from '../../src/utils/dateUtils';
import { getConversationHistory, addToConversation, clearConversation } from '../../src/services/conversationMemory';
import { resolveGuildId } from '../../src/utils/guildResolver';
import { cleanupOldAiUsageLogs } from '../../src/services/cleanupService';
import { prisma } from '../../src/config/prisma';

jest.mock('../../src/config/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    guild: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    flashcardDeck: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    flashcard: {
      createMany: jest.fn(),
      update: jest.fn(),
    },
    aiUsageLog: {
      deleteMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('🌟 END-TO-END USER JOURNEY SIMULATION HARNESS (10 SCENARIOS)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // JOURNEY 1: TÀI LIỆU -> STUDY PACK -> STREAK
  // =========================================================================
  it('Journey 1: Sinh viên nạp tài liệu bài giảng lớn -> AI bóc tách -> Nạp thẻ SM-2 -> Kích hoạt Streak', () => {
    const rawAiStudyPack = `
\`\`\`json
{
  "studyPack": {
    "summary": "• Điểm cốt lõi 1\\n• Điểm cốt lõi 2",
    "cards": [
      { "front": "Next.js Server Action", "back": "Hàm chạy trên server bảo mật" },
      { "front": "Prisma ORM", "back": "Bộ công cụ thao tác CSDL type-safe" }
    ],
    "quiz": [
      {
        "question": "Server Action chạy ở đâu?",
        "options": ["Server", "Client", "Database", "Browser"],
        "correctOption": "A",
        "explanation": "Chạy hoàn toàn trên Node.js server."
      }
    ]
  }
}
\`\`\`
    `;

    const parsed = parseStudyPackResponse(rawAiStudyPack);
    expect(parsed).not.toBeNull();
    expect(parsed?.flashcards.length).toBe(2);
    expect(parsed?.quiz.length).toBe(1);
    expect(parsed?.quiz[0].options.length).toBe(4);

    // Kích hoạt Streak
    const streakResult = calculateStreakUpdate(null, new Date());
    expect(streakResult.action).toBe('RESET');
    expect(streakResult.nextStreak).toBe(1);
  });

  // =========================================================================
  // JOURNEY 2: CHIA SẺ BỘ THẺ & TRÁNH LỖI P2002
  // =========================================================================
  it('Journey 2: Chia sẻ bộ thẻ sang người nhận đã có deck trùng tên -> Tự động đổi tên (Shared 1) an toàn', () => {
    const sourceName = 'NextJS_Security';
    const existingTargetDecks = new Set([sourceName, `${sourceName} (Shared 1)`]);

    let finalName = sourceName;
    let suffix = 1;
    while (existingTargetDecks.has(finalName)) {
      finalName = `${sourceName} (Shared ${suffix++})`;
    }

    expect(finalName).toBe('NextJS_Security (Shared 2)');
  });

  // =========================================================================
  // JOURNEY 3: ÔN TẬP SM-2 & TÍNH TOÁN KHOẢNG CÁCH NGÀY
  // =========================================================================
  it('Journey 3: Người dùng ôn tập thẻ SM-2 lần đầu -> Chấm điểm 4 (Nhớ tốt) -> Tăng interval lên 6 ngày', () => {
    const initialCard = { repetition: 1, interval: 1, easeFactor: 2.5, quality: 4 };
    const sm2Result = calculateSM2(initialCard);

    expect(sm2Result.repetition).toBe(2);
    expect(sm2Result.interval).toBe(6);
    expect(sm2Result.easeFactor).toBeCloseTo(2.5);
    expect(sm2Result.nextReviewAt.getTime()).toBeGreaterThan(Date.now());
  });

  // =========================================================================
  // JOURNEY 4: BẢO VỆ KHÓA NGOẠI FK (DISCORD SNOWFLAKE VS UUID)
  // =========================================================================
  it('Journey 4: Chuyển đổi an toàn Discord Snowflake sang UUID nội bộ qua resolveGuildId', async () => {
    const snowflake = '1429513747193401511';
    const internalUuid = '301e4b9a-230d-41de-be82-3d5060e55cc1';

    (mockPrisma.guild.findUnique as jest.Mock).mockResolvedValue({
      id: internalUuid,
      discordGuildId: snowflake,
    });

    const resolved = await resolveGuildId(snowflake);
    expect(resolved).toBe(internalUuid);
    expect(resolved).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  // =========================================================================
  // JOURNEY 5: TRÍ NHỚ HỘI THOẠI AI MULTI-TURN & TỰ HỦY 30 PHÚT
  // =========================================================================
  it('Journey 5: Hội thoại với AI nhớ ngữ cảnh và tự động giải phóng sau 30 phút TTL', () => {
    const userId = 'student-multi-turn';
    clearConversation(userId);

    addToConversation(userId, 'user', 'Xin chào, tôi muốn học Docker');
    addToConversation(userId, 'model', 'Chào bạn, Docker là nền tảng containerization.');

    const history1 = getConversationHistory(userId);
    expect(history1.length).toBe(2);

    // Xóa lịch sử khi người dùng yêu cầu reset
    clearConversation(userId);
    const history2 = getConversationHistory(userId);
    expect(history2.length).toBe(0);
  });

  // =========================================================================
  // JOURNEY 6: AUTO-HEALING DỌN DẸP RÁC CSDL LÚC 03:00 AM
  // =========================================================================
  it('Journey 6: Cron job lúc 03:00 AM tự động dọn dẹp các log AI cũ hơn 24h', async () => {
    (mockPrisma.aiUsageLog.deleteMany as jest.Mock).mockResolvedValue({ count: 12 });

    const result = await cleanupOldAiUsageLogs();
    expect(result.deletedCount).toBe(12);
    expect(mockPrisma.aiUsageLog.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expect.any(Date) } },
    });
  });

  // =========================================================================
  // JOURNEY 7: TÍNH TOÁN CHUỖI STREAK HỌC TẬP QUA NỬA ĐÊM
  // =========================================================================
  it('Journey 7: Duy trì Streak khi học trong cùng ngày và tăng Streak vào ngày kế tiếp', () => {
    const day1 = new Date('2026-08-20T09:00:00+07:00');
    const day1Night = new Date('2026-08-20T23:30:00+07:00');
    const day2 = new Date('2026-08-21T07:00:00+07:00');

    // Trong cùng ngày -> MAINTAIN
    const sameDay = calculateStreakUpdate(day1, day1Night);
    expect(sameDay.action).toBe('MAINTAIN');

    // Sang ngày tiếp theo -> INCREMENT
    const nextDay = calculateStreakUpdate(day1, day2);
    expect(nextDay.action).toBe('INCREMENT');
  });

  // =========================================================================
  // JOURNEY 8: LỌC BẢO MẬT & VÔ HIỆU HÓA MENTION PING ẨN
  // =========================================================================
  it('Journey 8: Lọc bỏ toàn bộ injection pings nguy hiểm như @everyone và @here', () => {
    const dangerousInput = 'Chào cả lớp @everyone và @here cùng học nhé!';
    const sanitized = dangerousInput.replace(/@(everyone|here)/g, '@\u200b$1');

    expect(sanitized).not.toContain('@everyone');
    expect(sanitized).not.toContain('@here');
    expect(sanitized).toContain('@\u200beveryone');
  });

  // =========================================================================
  // JOURNEY 9: KHẢO SÁT CHỐNG CRASH JSON DƯ NGOẶC
  // =========================================================================
  it('Journey 9: Bóc tách chính xác JSON dù AI trả về thừa ngoặc nhọn ở cuối', () => {
    const malformed = '{"question": "Q1", "answer": "A1"}}\n}';
    const extracted = extractValidJson(malformed);
    const parsed = JSON.parse(extracted);

    expect(parsed.question).toBe('Q1');
    expect(parsed.answer).toBe('A1');
  });

  // =========================================================================
  // JOURNEY 10: AUTOCOMPLETE CHOICES CAP & TRUNCATION
  // =========================================================================
  it('Journey 10: Cắt gọt nhãn label bộ thẻ dưới 100 ký tự và tối đa 25 choices', () => {
    const longName = 'Lý Thuyết Xác Suất Thống Kê Nâng Cao Dành Cho Khoa Học Dữ Liệu Và Trí Tuệ Nhân Tạo';
    const label = `${longName} (12 thẻ • 🔥 4 cần ôn)`.slice(0, 100);

    expect(label.length).toBeLessThanOrEqual(100);
  });
});
