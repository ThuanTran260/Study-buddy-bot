export interface ScoreResult {
  percentage: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
}

export function calculateScore({ total, correct }: { total: number; correct: number }): ScoreResult {
  const percentage = total === 0 ? 0 : Math.round((correct / total) * 100);
  let grade: ScoreResult['grade'];
  if (percentage === 100) grade = 'S';
  else if (percentage >= 90) grade = 'A';
  else if (percentage >= 70) grade = 'B';
  else if (percentage >= 50) grade = 'C';
  else if (percentage >= 30) grade = 'D';
  else grade = 'F';
  return { percentage, grade };
}

export function isValidQuizTopic(topic: string): boolean {
  return topic.trim().length > 0 && topic.length <= 200;
}
