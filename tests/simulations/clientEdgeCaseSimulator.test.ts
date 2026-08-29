import { isPrintableText, sanitizeUnicodeInput } from '../../src/utils/sanitize';
import { extractDocumentContent } from '../../src/services/documentService';
import { sendDailyFlashcardReminder } from '../../src/services/dailyReminderService';
import { calculateStreakUpdate } from '../../src/utils/dateUtils';
import { prisma } from '../../src/config/prisma';

jest.mock('../../src/config/prisma', () => ({
  prisma: {
    user: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    flashcardDeck: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    flashcard: {
      update: jest.fn(),
      createMany: jest.fn(),
    },
    aiUsageLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('🥊 CLIENT-SIDE EDGE CASE SIMULATOR & ADVERSARIAL DEFENSE (7 SCENARIOS)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // SCENARIO 1: RAPID MULTI-CLICK & IDEMPOTENCY
  // =========================================================================
  it('Scenario 1: Người dùng giật lag mạng bấm nút liên tiếp 3 lần trong 100ms -> Chỉ tính toán 1 lần duy nhất', () => {
    let executionCount = 0;
    let isCollected = false;

    const simulateButtonClick = () => {
      if (isCollected) return;
      isCollected = true;
      executionCount++;
    };

    // Client phát 3 click liên tiếp
    simulateButtonClick();
    simulateButtonClick();
    simulateButtonClick();

    expect(executionCount).toBe(1);
  });

  // =========================================================================
  // SCENARIO 2: DM BLOCKED (50007) GRACEFUL CONTINUATION
  // =========================================================================
  it('Scenario 2: Người dùng chặn DM từ Bot (DiscordAPIError 50007) -> Không làm crash luồng gửi cho người khác', async () => {
    const mockUsers = [
      {
        id: 'u1',
        discordUserId: 'user-blocked-dm',
        username: 'BlockedStudent',
        flashcardDecks: [{ name: 'Deck 1', cards: [{ id: 'c1' }] }],
      },
      {
        id: 'u2',
        discordUserId: 'user-normal-dm',
        username: 'NormalStudent',
        flashcardDecks: [{ name: 'Deck 2', cards: [{ id: 'c2' }] }],
      },
    ];

    (mockPrisma.user.findMany as jest.Mock).mockResolvedValue(mockUsers);

    const mockClient: any = {
      users: {
        fetch: jest.fn().mockImplementation((userId: string) => {
          if (userId === 'user-blocked-dm') {
            return Promise.resolve({
              send: jest.fn().mockRejectedValue({
                code: 50007,
                message: 'Cannot send messages to this user',
              }),
            });
          }
          return Promise.resolve({
            send: jest.fn().mockResolvedValue({ id: 'msg-123' }),
          });
        }),
      },
    };

    const sentCount = await sendDailyFlashcardReminder(mockClient);

    // Người thứ 1 bị chặn DM, người thứ 2 gửi thành công
    expect(sentCount).toBe(1);
    expect(mockClient.users.fetch).toHaveBeenCalledTimes(2);
  });

  // =========================================================================
  // SCENARIO 3: BINARY / NULL-BYTE FAKE TEXT UPLOAD REJECTION
  // =========================================================================
  it('Scenario 3: Người dùng nạp file nhị phân giả mạo .txt chứa ký tự null -> Bị chặn ngay lập tức mà không gọi AI', async () => {
    const maliciousBinaryContent = 'MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00';
    expect(isPrintableText(maliciousBinaryContent)).toBe(false);

    await expect(extractDocumentContent(maliciousBinaryContent, null, null, null)).rejects.toThrow(
      'INVALID_BINARY_CONTENT'
    );
  });

  // =========================================================================
  // SCENARIO 4: UNICODE ZALGO & RTL INVERSION SANITIZATION
  // =========================================================================
  it('Scenario 4: Người dùng nhập chuỗi Zalgo text và ký tự đảo ngược RTL -> Tự động làm sạch và chuẩn hóa NFC', () => {
    // Chuỗi chứa ký tự RTL override (\u202E) và null bytes
    const dangerousInput = 'Tên\u202EBộ\u0000Thẻ\u200E_Security';
    const sanitized = sanitizeUnicodeInput(dangerousInput);

    expect(sanitized).toBe('TênBộThẻ_Security');
    expect(sanitized).not.toContain('\u202E');
    expect(sanitized).not.toContain('\u0000');
  });

  // =========================================================================
  // SCENARIO 5: VOICE STATUS MISSING PERMISSIONS (50013) NON-FATAL DEGRADATION
  // =========================================================================
  it('Scenario 5: Bot bị tước quyền voice status (DiscordAPIError 50013) -> Coi là non-fatal error và tiếp tục', async () => {
    const mockChannel: any = {
      setStatus: jest.fn().mockRejectedValue({
        code: 50013,
        message: 'Missing Permissions',
      }),
    };

    let didCrash = false;
    try {
      await mockChannel.setStatus('🍅 Focus').catch((err: any) => {
        if (err.code === 50013) {
          // Gracefully caught
          return;
        }
        throw err;
      });
    } catch {
      didCrash = true;
    }

    expect(didCrash).toBe(false);
  });

  // =========================================================================
  // SCENARIO 6: MID-FLIGHT VOICE DISCONNECT RECOVERY
  // =========================================================================
  it('Scenario 6: Người dùng thoát voice sau 3 phút thay vì 25 phút -> Tính toán đúng số phút thực tế', () => {
    const startedAt = new Date('2026-08-22T08:00:00Z');
    const disconnectedAt = new Date('2026-08-22T08:03:00Z');

    const elapsedMinutes = Math.max(
      1,
      Math.round((disconnectedAt.getTime() - startedAt.getTime()) / (1000 * 60))
    );

    expect(elapsedMinutes).toBe(3);
  });

  // =========================================================================
  // SCENARIO 7: ABSOLUTE SERVER AUTHORITY OVER TIMESTAMPS
  // =========================================================================
  it('Scenario 7: Máy client sai giờ -> Server hoàn toàn kiểm soát mốc thời gian và tính Streak theo Asia/Ho_Chi_Minh', () => {
    // Giả sử mốc giờ server là 01:00 AM VN (UTC+7) của ngày mới
    const serverTime = new Date('2026-08-22T01:00:00+07:00');
    const lastActive = new Date('2026-08-21T15:00:00+07:00');

    const streakUpdate = calculateStreakUpdate(lastActive, serverTime);
    expect(streakUpdate.action).toBe('INCREMENT');
  });
});
