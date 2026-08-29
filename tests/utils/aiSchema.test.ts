import { safeParseAIJson, StudyPackSchema, StudyPackType } from '../../src/utils/aiSchema';

describe('aiSchema Zod Validation', () => {
  it('should parse valid StudyPack wrapped in markdown', () => {
    const raw = `
    \`\`\`json
    {
      "summary": "This is a summary of the text that is at least 10 chars.",
      "flashcards": [
        { "front": "Q1", "back": "A1" }
      ],
      "quiz": [
        {
          "question": "Test Q",
          "options": [
            { "label": "A", "text": "Op 1" },
            { "label": "B", "text": "Op 2" },
            { "label": "C", "text": "Op 3" },
            { "label": "D", "text": "Op 4" }
          ],
          "correctOption": "A",
          "explanation": "Because"
        }
      ]
    }
    \`\`\`
    `;

    const result = safeParseAIJson(raw, StudyPackSchema) as StudyPackType | null;
    expect(result).not.toBeNull();
    expect(result?.summary).toBe('This is a summary of the text that is at least 10 chars.');
    expect(result?.flashcards.length).toBe(1);
    expect(result?.quiz.length).toBe(1);
  });

  it('should safely unwrap wrong root keys like "cards"', () => {
    const raw = `
    {
      "mainPoints": "This is a summary of the text.",
      "cards": [
        { "front": "Q1", "back": "A1" }
      ],
      "questions": [
        {
          "question": "Test Q",
          "options": [
            { "label": "A", "text": "Op 1" },
            { "label": "B", "text": "Op 2" },
            { "label": "C", "text": "Op 3" },
            { "label": "D", "text": "Op 4" }
          ],
          "correctOption": "B",
          "explanation": "Because"
        }
      ]
    }
    `;

    const result = safeParseAIJson(raw, StudyPackSchema) as StudyPackType | null;
    expect(result).not.toBeNull();
    expect(result?.summary).toBe('This is a summary of the text.');
    expect(result?.flashcards.length).toBe(1);
    expect(result?.quiz.length).toBe(1);
    expect(result?.quiz[0].correctOption).toBe('B');
  });

  it('should return null for completely malformed JSON', () => {
    const raw = `I am an AI and I forgot to output JSON.`;
    const result = safeParseAIJson(raw, StudyPackSchema);
    expect(result).toBeNull();
  });
});
