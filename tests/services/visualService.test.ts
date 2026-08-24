import { renderMermaidToBuffer, generateAiIllustration } from '../../src/services/visualService';

describe('visualService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('renderMermaidToBuffer', () => {
    it('returns Buffer when QuickChart responds with 200 OK', async () => {
      const mockPngBuffer = Buffer.from('fake-png-binary-data');
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => mockPngBuffer.buffer,
      } as any);

      const result = await renderMermaidToBuffer('flowchart TD\n  A --> B');
      expect(result).not.toBeNull();
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('quickchart.io/mermaid?mermaid='),
        expect.any(Object)
      );
    });

    it('cleans markdown wrappers before calling QuickChart', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => Buffer.from('png').buffer,
      } as any);

      await renderMermaidToBuffer('```mermaid\nflowchart LR\n  Start --> Stop\n```');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent('flowchart LR\n  Start --> Stop')),
        expect.any(Object)
      );
    });

    it('returns null when QuickChart returns non-200 status', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      } as any);

      const result = await renderMermaidToBuffer('flowchart TD\n  Invalid');
      expect(result).toBeNull();
    });

    it('returns null on fetch error or timeout', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network timeout'));

      const result = await renderMermaidToBuffer('flowchart TD\n  A --> B');
      expect(result).toBeNull();
    });

    it('returns null for empty mermaid code', async () => {
      const result = await renderMermaidToBuffer('   ');
      expect(result).toBeNull();
    });
  });

  describe('generateAiIllustration', () => {
    it('returns null for empty prompt', async () => {
      const result = await generateAiIllustration('');
      expect(result).toBeNull();
    });
  });
});
