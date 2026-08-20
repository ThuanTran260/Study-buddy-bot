/**
 * SuperMemo-2 (SM-2) Spaced Repetition Algorithm Implementation
 * Based on Piotr Woźniak's mathematical memory model.
 */

export interface SM2Input {
  repetition: number; // Current repetition count (0 for new cards)
  interval: number;   // Current interval in days (default: 1)
  easeFactor: number; // Current Ease Factor (default: 2.5)
  quality: number;    // User rating: 1 (Forget) | 3 (Hard) | 4 (Good) | 5 (Easy)
}

export interface SM2Output {
  repetition: number;
  interval: number;
  easeFactor: number;
  nextReviewAt: Date;
}

export function calculateSM2({
  repetition,
  interval,
  easeFactor,
  quality,
}: SM2Input): SM2Output {
  // 1. Tính toán Ease Factor mới (EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)))
  // Ràng buộc: EF không bao giờ được nhỏ hơn 1.3
  const calculatedEF = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  const nextEaseFactor = Math.max(1.3, Number(calculatedEF.toFixed(2)));

  let nextRepetition = 0;
  let nextInterval = 1;

  // 2. Nếu trả lời Sai/Quên (quality < 3) -> Reset chu kỳ về ban đầu
  if (quality < 3) {
    nextRepetition = 0;
    nextInterval = 1;
  } else {
    // 3. Nếu trả lời Đúng (quality >= 3) -> Dùng repetition hiện tại để tính interval, sau đó tăng repetition
    if (repetition === 0) {
      nextInterval = 1;
    } else if (repetition === 1) {
      nextInterval = 6;
    } else {
      nextInterval = Math.round(interval * nextEaseFactor);
    }
    nextRepetition = repetition + 1;
  }

  // 4. Tính toán mốc thời gian ôn tập tiếp theo (+ nextInterval ngày)
  const nextReviewAt = new Date(Date.now() + nextInterval * 24 * 60 * 60 * 1000);

  return {
    repetition: nextRepetition,
    interval: nextInterval,
    easeFactor: nextEaseFactor,
    nextReviewAt,
  };
}
