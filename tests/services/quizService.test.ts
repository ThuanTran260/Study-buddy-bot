import { calculateScore, isValidQuizTopic } from '../../src/services/quizService';

describe('quizService', () => {
  it('calculates score correctly and assigns grades', () => {
    expect(calculateScore({ total: 5, correct: 5 })).toEqual({ percentage: 100, grade: 'S' });
    expect(calculateScore({ total: 10, correct: 9 })).toEqual({ percentage: 90, grade: 'A' });
    expect(calculateScore({ total: 10, correct: 7 })).toEqual({ percentage: 70, grade: 'B' });
    expect(calculateScore({ total: 10, correct: 5 })).toEqual({ percentage: 50, grade: 'C' });
    expect(calculateScore({ total: 10, correct: 3 })).toEqual({ percentage: 30, grade: 'D' });
    expect(calculateScore({ total: 5, correct: 0 })).toEqual({ percentage: 0, grade: 'F' });
  });

  it('validates quiz topics', () => {
    expect(isValidQuizTopic('Toán học đại cương')).toBe(true);
    expect(isValidQuizTopic('')).toBe(false);
    expect(isValidQuizTopic('   ')).toBe(false);
    expect(isValidQuizTopic('A'.repeat(201))).toBe(false);
  });
});
