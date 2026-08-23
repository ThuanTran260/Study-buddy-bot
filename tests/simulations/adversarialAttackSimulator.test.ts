import http from 'http';
import { sanitizeDiscordOutput, isPrintableText } from '../../src/utils/sanitize';
import { parseStudyPackResponse } from '../../src/services/aiService';
import { startHealthServer, closeHealthServer, registerHealthClient, resetHealthRateLimiter } from '../../src/utils/healthServer';
import { checkDbRateLimit } from '../../src/services/dbRateLimiter';
import { execute as flashcardExecute } from '../../src/commands/flashcard';
import { extractDocumentContent } from '../../src/services/documentService';
import { prisma } from '../../src/config/prisma';

jest.mock('../../src/config/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    flashcardDeck: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    flashcard: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    aiUsageLog: {
      count: jest.fn(),
      create: jest.fn(),
    },
  },
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('🛡️ ADVERSARIAL AI BOT ATTACK SIMULATION HARNESS (10 REAL-WORLD ATTACKS)', () => {
  let healthServer: http.Server;
  const TEST_PORT = 3999;

  beforeAll((done) => {
    const mockClient: any = {
      isReady: () => true,
      guilds: { cache: { size: 42 } },
    };
    registerHealthClient(mockClient);
    healthServer = startHealthServer(TEST_PORT);
    healthServer.on('listening', () => done());
  });

  afterAll(async () => {
    await closeHealthServer();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetHealthRateLimiter();
  });

  // =========================================================================
  // ATTACK 1: PROMPT INJECTION & GHOST MENTION ATTACK
  // =========================================================================
  it('Attack 1 [Ghost Ping & Mention Injection]: Kẻ tấn công chèn @everyone và <@&AdminRole> -> Bị vô hiệu hóa bằng Zero-width space', () => {
    const maliciousPayload = 'Chúc mừng bạn đã trúng thưởng! @everyone Hãy nhận quà tại <@&123456789012345678> ngay!';
    const sanitized = sanitizeDiscordOutput(maliciousPayload);

    expect(sanitized).not.toContain('@everyone');
    expect(sanitized).not.toContain('<@&123456789012345678>');
    expect(sanitized).toContain('@\u200beveryone');
    expect(sanitized).toContain('<@&\u200b123456789012345678>');
  });

  // =========================================================================
  // ATTACK 2: DENIAL OF WALLET (API TOKEN EXHAUSTION)
  // =========================================================================
  it('Attack 2 [Token Exhaustion & Spam]: Kẻ tấn công spam gọi AI liên tục -> Bị chặn bởi DB-Backed Rate Limiter', async () => {
    const userId = 'attacker-user-id';

    // Giả lập attacker đã gọi 3 lần trong giờ (chạm trần AI_DOCUMENT_STUDY)
    (mockPrisma.aiUsageLog.count as jest.Mock).mockResolvedValue(3);

    const check = await checkDbRateLimit(userId, 'AI_DOCUMENT_STUDY');
    expect(check.allowed).toBe(false);
    expect(check.remaining).toBe(0);
    expect(check.message).toContain('Bạn đã dùng hết hạn mức');
  });

  // =========================================================================
  // ATTACK 3: JSON SCHEMA RESILIENCE (UNTAMPERED PARSING)
  // =========================================================================
  it('Attack 3 [JSON Schema & Structure Resilience]: AI trả về JSON sai cấu trúc -> Zero-Trust parser xử lý an toàn không crash', () => {
    const maliciousAiOutput = `
\`\`\`json
{
  "system_override": true,
  "action": "DROP_TABLE",
  "flashcards": "MALFORMED_STRING_NOT_ARRAY",
  "quiz": null
}
\`\`\`
    `;

    const result = parseStudyPackResponse(maliciousAiOutput);
    expect(result).toBeNull();
  });

  // =========================================================================
  // ATTACK 4: IDOR (INSECURE DIRECT OBJECT REFERENCE) - TEST COMMAND HANDLER THẬT
  // =========================================================================
  it('Attack 4 [IDOR Data Hijack Defense]: Lệnh /flashcard review PHẢI bắt buộc ràng buộc userId trong query thật', async () => {
    const userA = { id: 'user-a-uuid', discordUserId: 'discord-user-a', username: 'UserA' };

    (mockPrisma.user.upsert as jest.Mock).mockResolvedValue(userA);
    (mockPrisma.flashcard.findMany as jest.Mock).mockResolvedValue([]);

    const mockInteraction: any = {
      user: { id: userA.discordUserId, username: userA.username },
      options: {
        getSubcommand: jest.fn().mockReturnValue('review'),
        getString: jest.fn().mockReturnValue('Security'),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
      deferred: false,
      replied: false,
    };

    // Gọi trực tiếp Command Handler thật của bot
    await flashcardExecute(mockInteraction);

    // Assert: Xác nhận Prisma query THỰC TẾ của bot phải chứa deck.userId = userA.id
    expect(mockPrisma.flashcard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deck: expect.objectContaining({
            userId: userA.id,
            name: 'Security',
          }),
        }),
      })
    );
  });

  // =========================================================================
  // ATTACK 5: MALICIOUS BINARY POLYGLOT (NULL-BYTE ATTACK)
  // =========================================================================
  it('Attack 5 [Binary Polyglot]: Tải lên file nhị phân đổi tên thành .txt chứa null bytes -> Bị sniffer chặn đứng', () => {
    const maliciousBinary = 'GIF89a\x00\x01\x00\x01\x00\x00\x00\xff\xff\xff';
    const isValid = isPrintableText(maliciousBinary);

    expect(isValid).toBe(false);
  });

  // =========================================================================
  // ATTACK 6: HEALTH CHECK METHOD TAMPERING (POST / DELETE)
  // =========================================================================
  it('Attack 6 [Health Method Tampering]: Gửi POST / DELETE tới /health -> Bị từ chối bằng mã 405 Method Not Allowed', async () => {
    const postResponse = await makeHttpRequest('POST', '/health', TEST_PORT);
    expect(postResponse.statusCode).toBe(405);
    expect(JSON.parse(postResponse.body).error).toBe('Method Not Allowed');

    const deleteResponse = await makeHttpRequest('DELETE', '/health', TEST_PORT);
    expect(deleteResponse.statusCode).toBe(405);
  });

  // =========================================================================
  // ATTACK 7: HEALTH CHECK RECONNAISSANCE & SENSITIVE PATH PROBING
  // =========================================================================
  it('Attack 7 [Endpoint Reconnaissance]: Kẻ tấn công quét đường dẫn /.env hoặc /debug -> Trả về 404 Not Found', async () => {
    const envProbe = await makeHttpRequest('GET', '/.env', TEST_PORT);
    expect(envProbe.statusCode).toBe(404);

    const debugProbe = await makeHttpRequest('GET', '/debug', TEST_PORT);
    expect(debugProbe.statusCode).toBe(404);
  });

  // =========================================================================
  // ATTACK 8: HEALTH CHECK INFORMATION LEAKAGE (A1 CHECKLIST)
  // =========================================================================
  it('Attack 8 [Information Leakage Guard]: Endpoint /health phản hồi tối giản { status: "ok" }, KHÔNG lộ số lượng server/guilds', async () => {
    const healthResponse = await makeHttpRequest('GET', '/health', TEST_PORT);
    expect(healthResponse.statusCode).toBe(200);

    const parsed = JSON.parse(healthResponse.body);
    expect(parsed.status).toBe('ok');
    expect(parsed.guilds).toBeUndefined();
    expect(parsed.version).toBeUndefined();
  });

  // =========================================================================
  // ATTACK 9: RATE LIMITER IP SPOOFING & MEMORY DOS REJECTION (XFF BYPASS DEFENSE)
  // =========================================================================
  it('Attack 9 [Rate Limiter IP Spoofing & Memory DoS Defense]: Đổi X-Forwarded-For mỗi request -> KHÔNG được bypass rate limit, trả về 429', async () => {
    const statusCodes: number[] = [];

    for (let i = 1; i <= 65; i++) {
      const res = await makeHttpRequest('GET', '/health', TEST_PORT, {
        'X-Forwarded-For': `10.9.9.${i}`,
      });
      statusCodes.push(res.statusCode);
    }

    const blockedCount = statusCodes.filter((code) => code === 429).length;
    // 60 request đầu qua (200), 5 request sau bị chặn (429) bởi Dual-Layer Rate Limiter
    expect(blockedCount).toBe(5);
  });

  // =========================================================================
  // ATTACK 10: PAYLOAD SIZE LIMIT DEFENSE (FILE OVERSIZE REJECTION)
  // =========================================================================
  it('Attack 10 [Payload Size Limit Defense]: Tải lên file có dung lượng 1.5MB (> 1MB) -> Bị chặn với lỗi FILE_TOO_LARGE ngay lập tức', async () => {
    const oversizeBytes = 1.5 * 1024 * 1024; // 1.5MB

    await expect(
      extractDocumentContent(null, 'https://cdn.discordapp.com/large.txt', 'large.txt', oversizeBytes)
    ).rejects.toThrow('FILE_TOO_LARGE');
  });
});

// Helper thực hiện HTTP request cho test với hỗ trợ headers tùy chỉnh
function makeHttpRequest(
  method: string,
  path: string,
  port: number,
  headers: Record<string, string> = {}
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode || 0, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}
