import { getVNCalendarDate, calculateStreakUpdate } from '../../src/utils/dateUtils';

describe('dateUtils', () => {
  describe('getVNCalendarDate', () => {
    it('formats date correctly in Asia/Ho_Chi_Minh timezone', () => {
      // 2026-08-20 16:30 UTC = 2026-08-20 23:30 VN
      const date1 = new Date('2026-08-20T16:30:00Z');
      expect(getVNCalendarDate(date1)).toBe('2026-08-20');

      // 2026-08-20 17:30 UTC = 2026-08-21 00:30 VN
      const date2 = new Date('2026-08-20T17:30:00Z');
      expect(getVNCalendarDate(date2)).toBe('2026-08-21');
    });
  });

  describe('calculateStreakUpdate', () => {
    it('returns RESET with 1 if no lastActiveDate', () => {
      const result = calculateStreakUpdate(null);
      expect(result.action).toBe('RESET');
      expect(result.nextStreak).toBe(1);
    });

    it('returns MAINTAIN if user already studied today (same VN day)', () => {
      const earlierToday = new Date('2026-08-20T08:00:00+07:00');
      const nowToday = new Date('2026-08-20T22:00:00+07:00');
      const result = calculateStreakUpdate(earlierToday, nowToday);
      expect(result.action).toBe('MAINTAIN');
    });

    it('returns INCREMENT if user studied yesterday (consecutive VN day)', () => {
      const yesterday = new Date('2026-08-19T23:30:00+07:00');
      const today = new Date('2026-08-20T00:30:00+07:00');
      const result = calculateStreakUpdate(yesterday, today);
      expect(result.action).toBe('INCREMENT');
    });

    it('returns RESET with 1 if user missed a day (> 1 day gap)', () => {
      const twoDaysAgo = new Date('2026-08-18T10:00:00+07:00');
      const today = new Date('2026-08-20T10:00:00+07:00');
      const result = calculateStreakUpdate(twoDaysAgo, today);
      expect(result.action).toBe('RESET');
      expect(result.nextStreak).toBe(1);
    });
  });
});
