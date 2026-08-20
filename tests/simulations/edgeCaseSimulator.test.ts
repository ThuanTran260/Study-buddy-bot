import { extractValidJson, parseAIJsonResponse, parseFlashcardAIResponse, parseStudyPackResponse } from '../../src/services/aiService';
import { calculateSM2 } from '../../src/services/sm2Service';
import { getVNCalendarDate, calculateStreakUpdate } from '../../src/utils/dateUtils';
import { sanitizeDiscordOutput } from '../../src/utils/sanitize';

describe('🛡️ ADVANCED CHAOS & EDGE-CASE SIMULATOR (Bộ Giả Lập Kiểm Thử Hệ Thống)', () => {
  // =========================================================================
  // SCENARIO 1: AI OUTPUT CHAOS & FUZZING TESTS
  // =========================================================================
  describe('Scenario 1: AI Malformed Output & Fuzzing (Giả lập phản hồi AI bị lỗi/nhiễu)', () => {
    it('Case 1.1: Handles extra trailing braces and characters (như lỗi /tailieu)', () => {
      const malformedJson = `{
        "summary": "• Tóm tắt bài học",
        "flashcards": [{"front": "Q1", "back": "A1"}],
        "quiz": [{"question": "Q1", "options": [{"label": "A", "text": "1"}, {"label": "B", "text": "2"}, {"label": "C", "text": "3"}, {"label": "D", "text": "4"}], "correctOption": "A", "explanation": "Exp"}]
      }
      }
      `;
      const parsed = parseStudyPackResponse(malformedJson);
      expect(parsed).not.toBeNull();
      expect(parsed?.flashcards.length).toBe(1);
    });

    it('Case 1.2: Handles markdown codeblocks with dirty text before/after JSON', () => {
      const dirtyMarkdown = `
      Dưới đây là Study Pack của bạn:
      \`\`\`json
      {
        "summary": ["• Luận điểm 1", "• Luận điểm 2"],
        "flashcards": [{"front": "Khái niệm", "back": "Định nghĩa"}],
        "quiz": [{"question": "Hỏi?", "options": ["A. Lựa chọn 1", "B. Lựa chọn 2", "C. Lựa chọn 3", "D. Lựa chọn 4"], "correctOption": "A.", "explanation": "Vì đúng"}]
      }
      \`\`\`
      Chúc bạn học tốt!
      `;
      const parsed = parseStudyPackResponse(dirtyMarkdown);
      expect(parsed).not.toBeNull();
      expect(parsed?.summary).toContain('Luận điểm 1');
      expect(parsed?.quiz[0].options[0].text).toBe('Lựa chọn 1');
      expect(parsed?.quiz[0].correctOption).toBe('A');
    });

    it('Case 1.3: Handles options formatted as key-value objects { "A": "text" }', () => {
      const kvJson = `{
        "summary": "Tóm tắt ngắn",
        "flashcards": [{"front": "F", "back": "B"}],
        "quiz": [{
          "question": "Câu hỏi?",
          "options": { "A": "Đáp án 1", "B": "Đáp án 2", "C": "Đáp án 3", "D": "Đáp án 4" },
          "correctOption": "b",
          "explanation": "Chi tiết"
        }]
      }`;
      const parsed = parseStudyPackResponse(kvJson);
      expect(parsed).not.toBeNull();
      expect(parsed?.quiz[0].options.length).toBe(4);
      expect(parsed?.quiz[0].correctOption).toBe('B');
    });

    it('Case 1.4: Handles alternative field names (term/definition, answer/reason)', () => {
      const aliasJson = `{
        "summary": "Tóm tắt",
        "flashcards": [{"term": "Thuật ngữ X", "definition": "Định nghĩa X"}],
        "quiz": [{
          "question": "Câu hỏi?",
          "options": [{"label": "A", "text": "1"}, {"label": "B", "text": "2"}, {"label": "C", "text": "3"}, {"label": "D", "text": "4"}],
          "answer": "C",
          "reason": "Giải thích"
        }]
      }`;
      const parsed = parseStudyPackResponse(aliasJson);
      expect(parsed).not.toBeNull();
      expect(parsed?.flashcards[0].front).toBe('Thuật ngữ X');
      expect(parsed?.quiz[0].correctOption).toBe('C');
      expect(parsed?.quiz[0].explanation).toBe('Giải thích');
    });

    it('Case 1.5: Safely rejects completely unrecoverable corrupt JSON without throwing', () => {
      const corruptData = 'Xin lỗi, tôi không thể xử lý tài liệu này.';
      expect(parseStudyPackResponse(corruptData)).toBeNull();
      expect(parseAIJsonResponse(corruptData)).toBeNull();
      expect(parseFlashcardAIResponse(corruptData)).toBeNull();
    });
  });

  // =========================================================================
  // SCENARIO 2: SM-2 SPACED REPETITION BOUNDARY CONDITIONS
  // =========================================================================
  describe('Scenario 2: Spaced Repetition (SM-2) Mathematical Boundary Tests', () => {
    it('Case 2.1: EaseFactor cannot drop below minimum floor 1.3 even with repeated failures (quality=1)', () => {
      let state = { repetition: 5, interval: 30, easeFactor: 1.35 };
      // 10 consecutive failures
      for (let i = 0; i < 10; i++) {
        const out = calculateSM2({
          quality: 1,
          repetition: state.repetition,
          interval: state.interval,
          easeFactor: state.easeFactor,
        });
        state = { repetition: out.repetition, interval: out.interval, easeFactor: out.easeFactor };
      }
      expect(state.easeFactor).toBeGreaterThanOrEqual(1.3);
      expect(state.easeFactor).toBe(1.3);
      expect(state.repetition).toBe(0);
      expect(state.interval).toBe(1);
    });

    it('Case 2.2: First-time review (repetition=0) with perfect recall (quality=5) sets interval to 1', () => {
      const result = calculateSM2({ quality: 5, repetition: 0, interval: 1, easeFactor: 2.5 });
      expect(result.repetition).toBe(1);
      expect(result.interval).toBe(1);
      expect(result.easeFactor).toBe(2.6);
    });

    it('Case 2.3: Second-time review (repetition=1) with quality >= 3 always sets interval to 6', () => {
      const result = calculateSM2({ quality: 4, repetition: 1, interval: 1, easeFactor: 2.6 });
      expect(result.repetition).toBe(2);
      expect(result.interval).toBe(6);
    });

    it('Case 2.4: Subsequent reviews (repetition >= 2) multiply interval by EaseFactor', () => {
      const result = calculateSM2({ quality: 5, repetition: 2, interval: 6, easeFactor: 2.6 });
      expect(result.repetition).toBe(3);
      expect(result.interval).toBe(16);
    });
  });

  // =========================================================================
  // SCENARIO 3: TIMEZONE & DATE BOUNDARY DRIFT TESTS (Asia/Ho_Chi_Minh)
  // =========================================================================
  describe('Scenario 3: Timezone Midnight Drift (Chuyển giao nửa đêm 23:59 -> 00:01)', () => {
    it('Case 3.1: Consecutive days in Vietnam timezone return correct date ordering', () => {
      const date1 = new Date('2026-08-20T16:59:00Z'); // 23:59 VN (2026-08-20)
      const date2 = new Date('2026-08-20T17:01:00Z'); // 00:01 VN (2026-08-21)

      const formatted1 = getVNCalendarDate(date1);
      const formatted2 = getVNCalendarDate(date2);

      expect(formatted1).toBe('2026-08-20');
      expect(formatted2).toBe('2026-08-21');

      const streakCalc = calculateStreakUpdate(date1, date2);
      expect(streakCalc.action).toBe('INCREMENT');
      expect(streakCalc.nextStreak).toBe(1);
    });

    it('Case 3.2: Same calendar day within Vietnam timezone maintains streak', () => {
      const morning = new Date('2026-08-20T01:00:00Z'); // 08:00 AM VN
      const night = new Date('2026-08-20T15:00:00Z');   // 22:00 PM VN

      expect(getVNCalendarDate(morning)).toBe(getVNCalendarDate(night));

      const streakCalc = calculateStreakUpdate(morning, night);
      expect(streakCalc.action).toBe('MAINTAIN');
    });

    it('Case 3.3: Gap greater than 1 day resets streak', () => {
      const day1 = new Date('2026-08-15T10:00:00Z');
      const day3 = new Date('2026-08-20T10:00:00Z');

      const streakCalc = calculateStreakUpdate(day1, day3);
      expect(streakCalc.action).toBe('RESET');
      expect(streakCalc.nextStreak).toBe(1);
    });
  });

  // =========================================================================
  // SCENARIO 4: SECURITY & SANITIZATION INJECTION TESTS
  // =========================================================================
  describe('Scenario 4: Security Sanitization & Prompt Injection Protection', () => {
    it('Case 4.1: Neutralizes @everyone, @here, and role mention ping exploits', () => {
      const maliciousOutput = 'Chúc mừng @everyone và <@&123456789> đã hoàn thành bài tập!';
      const sanitized = sanitizeDiscordOutput(maliciousOutput);
      expect(sanitized).not.toContain('@everyone');
      expect(sanitized).toContain('@\u200beveryone');
      expect(sanitized).not.toContain('<@&123456789>');
      expect(sanitized).toContain('<@&\u200b123456789>');
    });

    it('Case 4.2: Handles extreme character flooding gracefully', () => {
      const hugeInput = 'A'.repeat(50_000);
      const sanitized = sanitizeDiscordOutput(hugeInput);
      expect(typeof sanitized).toBe('string');
      expect(sanitized.length).toBe(50_000);
    });
  });
});
