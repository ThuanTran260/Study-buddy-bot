import { splitMessage, splitForEmbedAndFollowUp } from '../../src/utils/messageSplitter';

describe('messageSplitter', () => {
  it('splits message safely without infinite loop or empty strings', () => {
    const longText = 'A'.repeat(5000);
    const chunks = splitMessage(longText, 2000);
    expect(chunks.length).toBe(3);
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(2000));
  });

  it('splits for Embed (max 4000) and follow-up content (max 2000)', () => {
    const hugeText = 'Paragraph test.\n\n'.repeat(300); // ~5100 chars
    const { embedChunk, followUpChunks } = splitForEmbedAndFollowUp(hugeText);
    expect(embedChunk.length).toBeLessThanOrEqual(4000);
    expect(followUpChunks.length).toBeGreaterThan(0);
    followUpChunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(2000));
  });

  it('handles short text within limits without follow-up', () => {
    const shortText = 'Short response from AI';
    const { embedChunk, followUpChunks } = splitForEmbedAndFollowUp(shortText);
    expect(embedChunk).toBe(shortText);
    expect(followUpChunks).toEqual([]);
  });
});
