import { safeParseAIJson, VisualResponseSchema, VisualResponseType } from '../../src/utils/aiSchema';
import { redisClient } from '../../src/config/redis';

describe('Visual Edge Cases & Defensive Architecture', () => {
  describe('VisualResponseSchema Fuzzing & Normalization', () => {
    it('correctly parses pure text response with hasVisual = false', () => {
      const raw = JSON.stringify({
        textAnswer: 'Đây là câu trả lời thuần túy.',
        hasVisual: false,
      });

      const parsed = safeParseAIJson(raw, VisualResponseSchema) as VisualResponseType | null;
      expect(parsed).not.toBeNull();
      expect(parsed?.textAnswer).toBe('Đây là câu trả lời thuần túy.');
      expect(parsed?.hasVisual).toBe(false);
      expect(parsed?.visualType).toBeUndefined();
    });

    it('normalizes alias keys like "explanation", "diagram", "code"', () => {
      const raw = JSON.stringify({
        explanation: 'Sơ đồ luồng JWT',
        diagram: true,
        visualType: 'diagram',
        code: 'flowchart TD\n A --> B',
      });

      const parsed = safeParseAIJson(raw, VisualResponseSchema) as VisualResponseType | null;
      expect(parsed).not.toBeNull();
      expect(parsed?.textAnswer).toBe('Sơ đồ luồng JWT');
      expect(parsed?.hasVisual).toBe(true);
      expect(parsed?.visualType).toBe('mermaid');
      expect(parsed?.visualPromptOrCode).toBe('flowchart TD\n A --> B');
    });

    it('normalizes illustration alias for image generation', () => {
      const raw = JSON.stringify({
        text: 'Cấu tạo tế bào thực vật',
        visual: true,
        visualType: 'illustration',
        prompt: 'Plant cell with chloroplast and cell wall',
      });

      const parsed = safeParseAIJson(raw, VisualResponseSchema) as VisualResponseType | null;
      expect(parsed).not.toBeNull();
      expect(parsed?.hasVisual).toBe(true);
      expect(parsed?.visualType).toBe('image');
      expect(parsed?.visualPromptOrCode).toBe('Plant cell with chloroplast and cell wall');
    });

    it('unwraps array-wrapped AI JSON output gracefully', () => {
      const raw = JSON.stringify([
        {
          textAnswer: 'Mô hình MVC trong web development',
          hasVisual: true,
          visualType: 'mermaid',
          visualPromptOrCode: 'flowchart LR\n Model --> View --> Controller',
        },
      ]);

      const parsed = safeParseAIJson(raw, VisualResponseSchema) as VisualResponseType | null;
      expect(parsed).not.toBeNull();
      expect(parsed?.textAnswer).toBe('Mô hình MVC trong web development');
      expect(parsed?.visualType).toBe('mermaid');
    });
  });

  describe('Atomic Redis Locking for Visual Button Spams', () => {
    const lockKey = 'visual_lock:test-message-123';

    beforeEach(async () => {
      await redisClient.del(lockKey);
    });

    afterAll(async () => {
      await redisClient.del(lockKey);
    });

    it('acquires lock on first click and rejects concurrent second click (Anti-Spam Idempotency)', async () => {
      // First click
      const acquired1 = await redisClient.set(lockKey, '1', 'EX', 60, 'NX');
      expect(acquired1).toBeTruthy();

      // Immediate second click (double-click simulation)
      const acquired2 = await redisClient.set(lockKey, '1', 'EX', 60, 'NX');
      expect(acquired2).toBeNull(); // Blocked by Redis Lock!
    });
  });
});
