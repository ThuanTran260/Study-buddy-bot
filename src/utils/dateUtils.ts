/**
 * Date and Timezone Utilities for Vietnam Timezone (Asia/Ho_Chi_Minh - UTC+7)
 */

export function getVNCalendarDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export type StreakAction = 'INCREMENT' | 'MAINTAIN' | 'RESET';

export function calculateStreakUpdate(
  lastActiveDate: Date | null,
  currentDate: Date = new Date()
): { action: StreakAction; nextStreak: number } {
  if (!lastActiveDate) {
    return { action: 'RESET', nextStreak: 1 };
  }

  const todayVN = getVNCalendarDate(currentDate);
  const lastActiveVN = getVNCalendarDate(lastActiveDate);

  if (todayVN === lastActiveVN) {
    return { action: 'MAINTAIN', nextStreak: 0 }; // 0 signals maintain existing
  }

  const todayMs = new Date(todayVN).getTime();
  const lastMs = new Date(lastActiveVN).getTime();
  const diffDays = Math.round((todayMs - lastMs) / (1000 * 60 * 60 * 24));

  if (diffDays === 1) {
    return { action: 'INCREMENT', nextStreak: 1 }; // +1 to existing streak
  }

  // If gap is > 1 day or negative (clock skew), reset to 1
  return { action: 'RESET', nextStreak: 1 };
}
