import { parseAIJsonResponse } from '../../src/services/aiService';

describe('parseAIJsonResponse', () => {
  it('parses valid Quiz questions format', () => {
    const validJson = JSON.stringify({
      questions: [
        {
          question: 'TypeScript là gì?',
          options: [
            { label: 'A', text: 'Superset của JS' },
            { label: 'B', text: 'Ngôn ngữ khác hoàn toàn' },
            { label: 'C', text: 'Framework' },
            { label: 'D', text: 'Database' },
          ],
          correctOption: 'A',
          explanation: 'TypeScript mở rộng cú pháp JavaScript.',
        },
      ],
    });
    const parsed = parseAIJsonResponse(validJson);
    expect(parsed).not.toBeNull();
    expect(parsed?.length).toBe(1);
    expect(parsed?.[0].correctOption).toBe('A');
  });

  it('rejects invalid option formats', () => {
    const invalid = JSON.stringify({ questions: [{ question: 'Q', correctOption: 'E' }] });
    expect(parseAIJsonResponse(invalid)).toBeNull();
  });
});
