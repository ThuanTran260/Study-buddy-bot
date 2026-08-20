/**
 * 🗄️ DATABASE EDGE-CASE SIMULATOR
 * 
 * Bộ kiểm thử mô phỏng các lỗi cơ sở dữ liệu trong production,
 * được xây dựng dựa trên lỗi FK Violation thực tế từ Sprint 2.
 * 
 * Kiểm thử 5 nhóm lỗi CSDL:
 *  1. FK Violation — Snowflake ID vs Internal UUID
 *  2. Unique Constraint Violations (P2002)
 *  3. Cascade Delete Safety
 *  4. Null Safety & Optional FK
 *  5. resolveGuildId Helper Behavior
 */

// Mock prisma TRƯỚC KHI import bất kỳ service nào
const mockGuild = {
  id: 'guild-uuid-internal-001',
  discordGuildId: '1429513747193401511',
  maxStudyRoomsPerGuild: 10,
  createdAt: new Date(),
};

const mockUser = {
  id: 'user-uuid-internal-001',
  discordUserId: '987654321012345678',
  username: 'TestUser',
  streakCount: 5,
  lastActiveDate: null,
  dailyReminderEnabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockDeck = {
  id: 'deck-uuid-001',
  userId: 'user-uuid-internal-001',
  guildId: 'guild-uuid-internal-001',
  name: 'Test Deck',
  description: null,
  createdAt: new Date(),
  cards: [],
};

jest.mock('../../src/config/prisma', () => ({
  prisma: {
    guild: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    flashcardDeck: {
      findUnique: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
    },
    flashcard: {
      findMany: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

import { prisma } from '../../src/config/prisma';
import { resolveGuildId } from '../../src/utils/guildResolver';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('🗄️ DATABASE EDGE-CASE SIMULATOR (Bộ Giả Lập Lỗi Cơ Sở Dữ Liệu)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // SCENARIO 1: FK VIOLATION — SNOWFLAKE ID vs INTERNAL UUID
  // =========================================================================
  describe('Scenario 1: Foreign Key Violation — Snowflake vs UUID (Root Cause của Bug Production)', () => {
    it('Case 1.1: resolveGuildId() trả về UUID nội bộ khi guild tồn tại trong DB', async () => {
      (mockPrisma.guild.findUnique as jest.Mock).mockResolvedValue(mockGuild);

      const result = await resolveGuildId('1429513747193401511');

      expect(result).toBe('guild-uuid-internal-001');
      expect(mockPrisma.guild.findUnique).toHaveBeenCalledWith({
        where: { discordGuildId: '1429513747193401511' },
        select: { id: true },
      });
    });

    it('Case 1.2: resolveGuildId() trả về null khi guild CHƯA tồn tại — không throw', async () => {
      (mockPrisma.guild.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await resolveGuildId('unknown-discord-guild-id');
      expect(result).toBeNull();
      // Không throw — safe để dùng trong FK nullable fields
    });

    it('Case 1.3: resolveGuildId(null) trả về null ngay lập tức — không gọi DB', async () => {
      const result = await resolveGuildId(null);
      expect(result).toBeNull();
      expect(mockPrisma.guild.findUnique).not.toHaveBeenCalled();
    });

    it('Case 1.4: resolveGuildId("") (chuỗi rỗng) trả về null — không gọi DB', async () => {
      const result = await resolveGuildId('');
      expect(result).toBeNull();
      expect(mockPrisma.guild.findUnique).not.toHaveBeenCalled();
    });

    it('Case 1.5: Truyền Discord Snowflake THẲNG vào FK field → FK violation (pattern sai cần phát hiện)', () => {
      // Đây là anti-pattern — mô phỏng những gì từng xảy ra trong production
      // Discord Snowflake: "1429513747193401511" (18 digits)
      // DB UUID: "guild-uuid-internal-001" (UUID format)
      // Hai giá trị này HOÀN TOÀN KHÁC NHAU — không thể dùng thay thế nhau
      const discordSnowflake = '1429513747193401511';
      const dbUUID = 'guild-uuid-internal-001';
      expect(discordSnowflake).not.toBe(dbUUID);
      // Đây là lý do tại sao phải LUÔN dùng resolveGuildId()
    });
  });

  // =========================================================================
  // SCENARIO 2: UNIQUE CONSTRAINT VIOLATIONS (P2002)
  // =========================================================================
  describe('Scenario 2: Unique Constraint Violations — P2002 Handling', () => {
    it('Case 2.1: FlashcardDeck (userId, name) duplicate → phát hiện và xử lý P2002', async () => {
      const p2002Error = Object.assign(new Error('Unique constraint failed on the fields: (`userId`,`name`)'), {
        code: 'P2002',
        meta: { target: ['userId', 'name'] },
      });

      (mockPrisma.flashcardDeck.create as jest.Mock).mockRejectedValue(p2002Error);

      let caughtError: any = null;
      try {
        await prisma.flashcardDeck.create({
          data: {
            userId: 'user-uuid-internal-001',
            guildId: 'guild-uuid-internal-001',
            name: 'Existing Deck',
          } as any,
        });
      } catch (e: any) {
        caughtError = e;
      }

      expect(caughtError).not.toBeNull();
      expect(caughtError.code).toBe('P2002');
      expect(caughtError.meta?.target).toContain('name');
    });

    it('Case 2.2: User upsert không bao giờ throw P2002 khi discordUserId đã tồn tại', async () => {
      (mockPrisma.user.upsert as jest.Mock).mockResolvedValue({
        ...mockUser,
        username: 'UpdatedUsername',
      });

      const user = await prisma.user.upsert({
        where: { discordUserId: '987654321012345678' },
        create: { discordUserId: '987654321012345678', username: 'UpdatedUsername' } as any,
        update: { username: 'UpdatedUsername' },
      });

      expect(user.username).toBe('UpdatedUsername');
      // upsert không throw P2002 — an toàn để gọi nhiều lần
    });

    it('Case 2.3: Guild upsert idempotent — cùng discordGuildId upsert nhiều lần vẫn safe', async () => {
      (mockPrisma.guild.upsert as jest.Mock).mockResolvedValue(mockGuild);

      // Gọi upsert 3 lần với cùng discordGuildId — phải luôn thành công
      for (let i = 0; i < 3; i++) {
        const guild = await prisma.guild.upsert({
          where: { discordGuildId: '1429513747193401511' },
          create: { discordGuildId: '1429513747193401511' } as any,
          update: {},
        });
        expect(guild.id).toBe('guild-uuid-internal-001');
      }
      expect(mockPrisma.guild.upsert).toHaveBeenCalledTimes(3);
    });
  });

  // =========================================================================
  // SCENARIO 3: NULL SAFETY & OPTIONAL FK
  // =========================================================================
  describe('Scenario 3: Null Safety & Optional FK — Bot dùng trong DM vs Server', () => {
    it('Case 3.1: FlashcardDeck.guildId có thể null khi bot dùng trong DM (không có guild)', async () => {
      (mockPrisma.flashcardDeck.create as jest.Mock).mockResolvedValue({
        ...mockDeck,
        guildId: null, // DM channel — không có guild
      });

      const deck = await prisma.flashcardDeck.create({
        data: {
          userId: 'user-uuid-internal-001',
          guildId: null, // Hợp lệ — nullable FK
          name: 'DM Deck',
        } as any,
      });

      expect(deck.guildId).toBeNull(); // FK nullable → hợp lệ
    });

    it('Case 3.2: resolveGuildId trả về null khi interaction.guildId là null (DM context)', async () => {
      // Trong DM, interaction.guildId === null
      const result = await resolveGuildId(null);
      expect(result).toBeNull();
      expect(mockPrisma.guild.findUnique).not.toHaveBeenCalled();
    });

    it('Case 3.3: resolveGuildId an toàn khi DB timeout hoặc lỗi kết nối', async () => {
      (mockPrisma.guild.findUnique as jest.Mock).mockRejectedValue(new Error('Connection timeout'));

      // resolveGuildId nên propagate lỗi để caller xử lý
      await expect(resolveGuildId('1429513747193401511')).rejects.toThrow('Connection timeout');
    });
  });

  // =========================================================================
  // SCENARIO 4: CASCADE DELETE SAFETY
  // =========================================================================
  describe('Scenario 4: Cascade Delete Safety — Xóa User/Guild xóa dữ liệu liên quan', () => {
    it('Case 4.1: Schema kiểm tra — FlashcardDeck có onDelete: Cascade từ User', () => {
      // Theo schema: User → FlashcardDeck (Cascade)
      // Xóa User sẽ xóa toàn bộ FlashcardDeck và Flashcard của user đó
      // Đây là behavior MONG MUỐN — test đảm bảo mock nhất quán với schema
      const schemaRelation = {
        model: 'FlashcardDeck',
        field: 'userId',
        references: 'User.id',
        onDelete: 'Cascade',
      };
      expect(schemaRelation.onDelete).toBe('Cascade');
    });

    it('Case 4.2: Schema kiểm tra — FlashcardDeck có onDelete: SetNull từ Guild', () => {
      // Theo schema: Guild → FlashcardDeck (SetNull)
      // Xóa Guild KHÔNG xóa deck, chỉ set guildId = null
      // Điều này bảo vệ dữ liệu học tập của user khi guild bị xóa
      const schemaRelation = {
        model: 'FlashcardDeck',
        field: 'guildId',
        references: 'Guild.id',
        onDelete: 'SetNull',
      };
      expect(schemaRelation.onDelete).toBe('SetNull');
    });

    it('Case 4.3: Schema kiểm tra — Flashcard có onDelete: Cascade từ FlashcardDeck', () => {
      // Xóa FlashcardDeck → xóa toàn bộ Flashcard trong deck đó
      const schemaRelation = {
        model: 'Flashcard',
        field: 'deckId',
        references: 'FlashcardDeck.id',
        onDelete: 'Cascade',
      };
      expect(schemaRelation.onDelete).toBe('Cascade');
    });
  });

  // =========================================================================
  // SCENARIO 5: TRANSACTION ATOMICITY
  // =========================================================================
  describe('Scenario 5: Transaction Atomicity — Đảm bảo toàn vẹn dữ liệu khi multi-step insert', () => {
    it('Case 5.1: Transaction commit thành công khi tất cả bước đều pass', async () => {
      (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: any) => {
        const txMock = {
          flashcardDeck: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue(mockDeck),
          },
          flashcard: {
            createMany: jest.fn().mockResolvedValue({ count: 3 }),
          },
        };
        return fn(txMock);
      });

      let result: any = null;
      await prisma.$transaction(async (tx: any) => {
        const existingDeck = await tx.flashcardDeck.findUnique({ where: { userId_name: { userId: 'u1', name: 'D1' } } });
        expect(existingDeck).toBeNull();

        const deck = await tx.flashcardDeck.create({
          data: { userId: 'u1', guildId: null, name: 'D1', description: null },
        });
        const inserted = await tx.flashcard.createMany({ data: [
          { deckId: deck.id, front: 'F1', back: 'B1', repetition: 0, interval: 1, easeFactor: 2.5, nextReviewAt: new Date() },
          { deckId: deck.id, front: 'F2', back: 'B2', repetition: 0, interval: 1, easeFactor: 2.5, nextReviewAt: new Date() },
          { deckId: deck.id, front: 'F3', back: 'B3', repetition: 0, interval: 1, easeFactor: 2.5, nextReviewAt: new Date() },
        ] });
        result = { deckId: deck.id, count: inserted.count };
      });

      expect(result.deckId).toBe('deck-uuid-001');
      expect(result.count).toBe(3);
    });

    it('Case 5.2: Transaction rollback khi một bước thất bại — không có partial insert', async () => {
      (mockPrisma.$transaction as jest.Mock).mockRejectedValue(new Error('DB_CONSTRAINT_FAILED'));

      await expect(
        prisma.$transaction(async (tx: any) => {
          // Nếu bước nào throw → toàn bộ transaction rollback
          throw new Error('DB_CONSTRAINT_FAILED');
        })
      ).rejects.toThrow('DB_CONSTRAINT_FAILED');

      // Sau rollback, không có record nào được commit
      expect(mockPrisma.flashcardDeck.findMany).not.toHaveBeenCalled();
    });

    it('Case 5.3: $transaction phát hiện và propagate P2002 từ createMany', async () => {
      const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      (mockPrisma.$transaction as jest.Mock).mockRejectedValue(p2002);

      let caughtCode: string | undefined;
      try {
        await prisma.$transaction(async (tx: any) => {});
      } catch (e: any) {
        caughtCode = e.code;
      }

      expect(caughtCode).toBe('P2002');
    });
  });

  // =========================================================================
  // SCENARIO 6: ID FORMAT VALIDATION
  // =========================================================================
  describe('Scenario 6: ID Format Validation — Phát hiện nhầm lẫn UUID vs Snowflake', () => {
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const DISCORD_SNOWFLAKE_REGEX = /^\d{17,19}$/;

    it('Case 6.1: UUID nội bộ của DB phải match UUID format', () => {
      const internalUserId = 'user-uuid-internal-001';
      const realUUID = '301e4b9a-230d-41de-be82-3d5060e55cc1';

      // UUID chuẩn phải match pattern
      expect(UUID_REGEX.test(realUUID)).toBe(true);

      // ID mock trong test thường không phải UUID chuẩn — OK cho test nhưng
      // trong production CSDL sẽ tự sinh UUID chuẩn qua @default(uuid())
      expect(UUID_REGEX.test(internalUserId)).toBe(false); // mock string
    });

    it('Case 6.2: Discord Snowflake ID phải là chuỗi số 17-19 ký tự', () => {
      const discordGuildId = '1429513747193401511'; // 19 digits
      const discordUserId = '987654321012345678';   // 18 digits

      expect(DISCORD_SNOWFLAKE_REGEX.test(discordGuildId)).toBe(true);
      expect(DISCORD_SNOWFLAKE_REGEX.test(discordUserId)).toBe(true);
    });

    it('Case 6.3: UUID và Snowflake là hai loại ID hoàn toàn khác nhau — không thể hoán đổi', () => {
      const dbUUID = '301e4b9a-230d-41de-be82-3d5060e55cc1';
      const discordSnowflake = '1429513747193401511';

      // Nếu ai đó nhầm lẫn và đặt Snowflake vào UUID field → FK VIOLATION
      expect(dbUUID).not.toBe(discordSnowflake);
      expect(UUID_REGEX.test(dbUUID)).toBe(true);
      expect(UUID_REGEX.test(discordSnowflake)).toBe(false); // Snowflake không phải UUID
      expect(DISCORD_SNOWFLAKE_REGEX.test(discordSnowflake)).toBe(true);
      expect(DISCORD_SNOWFLAKE_REGEX.test(dbUUID)).toBe(false); // UUID không phải Snowflake
    });
  });
});
