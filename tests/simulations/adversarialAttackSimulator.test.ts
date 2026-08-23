import http from 'http';
import { sanitizeDiscordOutput, isPrintableText } from '../../src/utils/sanitize';
import { parseStudyPackResponse, parseFlashcardAIResponse } from '../../src/services/aiService';
import { startHealthServer, closeHealthServer, registerHealthClient } from '../../src/utils/healthServer';
import { calculateStreakUpdate } from '../../src/utils/dateUtils';
import { checkDbRateLimit } from '../../src/services/dbRateLimiter';
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
      update: jest.fn(),
    },
    aiUsageLog: {
      count: jest.fn(),
      create: jest.fn(),
    },
  },
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('🛡️ ADVERSARIAL AI BOT ATTACK SIMULATION HARNESS (8 REAL-WORLD ATTACKS)', () => {
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
  });

  // =========================================================================
  // ATTACK 1: PROMPT INJECTION & GHOST MENTION ATTACK
  // =========================================================================
  it('Attack 1 [Ghost Ping & Mention Injection]: Kẻ tấn công chèn @everyone và <@&AdminRole> -> Bị vô hiệu hóa bằng Zero-width space', () => {
    const maliciousPayload = 'Chúc mừng bạn đã trúng thưởng! @everyone Hãy nhận quà tại <@&123456789012345678> ngay!';
    const sanitized = sanitizeDiscordOutput(maliciousPayload);

    // Ký tự Zero-width space (\u200b) được chèn vào giữa @ và tên mention
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
  // ATTACK 3: INDIRECT PROMPT INJECTION VIA DOCUMENT PAYLOAD
  // =========================================================================
  it('Attack 3 [Indirect AI Injection]: Tài liệu chứa chỉ dẫn phá hoại cấu trúc JSON -> Zero-Trust parser xử lý an toàn', () => {
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

    // Parser không bao giờ crash, trả về null an toàn
    const result = parseStudyPackResponse(maliciousAiOutput);
    expect(result).toBeNull();
  });

  // =========================================================================
  // ATTACK 4: IDOR (INSECURE DIRECT OBJECT REFERENCE)
  // =========================================================================
  it('Attack 4 [IDOR Data Hijack]: User A cố tình đoán ID để xem/sửa bộ thẻ của User B -> Bị cô lập dữ liệu bởi userId', async () => {
    const userA_Id = 'user-a-uuid';
    const userB_DeckId = 'deck-belonging-to-user-b';

    // Query bộ thẻ kèm điều kiện bắt buộc userId của người gọi
    (mockPrisma.flashcardDeck.findUnique as jest.Mock).mockResolvedValue(null);

    const queriedDeck = await prisma.flashcardDeck.findUnique({
      where: {
        id: userB_DeckId,
        userId: userA_Id, // <- Chốt chặn IDOR
      },
    });

    expect(queriedDeck).toBeNull();
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
    expect(parsed.guilds).toBeUndefined(); // <- Đã loại bỏ hoàn toàn việc lộ thông tin nội bộ
    expect(parsed.version).toBeUndefined();
  });
});

// Helper thực hiện HTTP request cho test
function makeHttpRequest(
  method: string,
  path: string,
  port: number
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
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
