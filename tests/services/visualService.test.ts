import {
  renderMermaidToBuffer,
  generateAiIllustration,
  extractMermaidCode,
  sanitizeMermaidCode,
} from '../../src/services/visualService';

describe('visualService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('extractMermaidCode', () => {
    it('extracts code from markdown block ```mermaid ... ```', () => {
      const text = 'Chào bạn, đây là sơ đồ:\n```mermaid\nsequenceDiagram\n  Client->>Server: Login\n```\nChúc bạn học tốt!';
      const extracted = extractMermaidCode(text);
      expect(extracted).toBe('sequenceDiagram\n  Client->>Server: Login');
    });

    it('extracts un-fenced sequenceDiagram keyword directly from raw text', () => {
      const text = 'Chào bạn!\nsequenceDiagram\n  autonumber\n  Client->>Server: Login\n\nGiải thích...';
      const extracted = extractMermaidCode(text);
      expect(extracted).toContain('sequenceDiagram');
      expect(extracted).toContain('Client->>Server: Login');
    });

    it('returns null when text contains no mermaid syntax', () => {
      const text = 'Chỉ là câu trả lời văn bản thông thường không có sơ đồ.';
      expect(extractMermaidCode(text)).toBeNull();
    });
  });

  describe('sanitizeMermaidCode (Auto-Healer)', () => {
    it('auto-heals invalid sequenceDiagram keywords like database, queue to participant', () => {
      const dirtyCode = `sequenceDiagram
    autonumber
    actor Client as Client (Trình duyệt/App)
    participant Server as API Server
    database DB as Database
    queue Q as Event Queue
    Client->>Server: Login`;

      const healed = sanitizeMermaidCode(dirtyCode);
      expect(healed).not.toContain('database DB as Database');
      expect(healed).not.toContain('queue Q as Event Queue');
      expect(healed).toContain('participant DB as Database');
      expect(healed).toContain('participant Q as Event Queue');
    });
  });

  describe('renderMermaidToBuffer', () => {
    it('returns Buffer when Mermaid.ink responds with 200 OK', async () => {
      const mockPngBuffer = Buffer.from('fake-png-binary-data');
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => mockPngBuffer.buffer,
      } as any);

      const result = await renderMermaidToBuffer('flowchart TD\n  A --> B');
      expect(result).not.toBeNull();
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://mermaid.ink/img/pako:'),
        expect.objectContaining({
          method: 'GET',
        })
      );
    });

    it('cleans markdown wrappers before calling Mermaid.ink', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => Buffer.from('png').buffer,
      } as any);

      await renderMermaidToBuffer('```mermaid\nflowchart LR\n  Start --> Stop\n```');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://mermaid.ink/img/pako:'),
        expect.any(Object)
      );
    });

    it('returns null when Mermaid.ink returns non-200 status', async () => {
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
    it('returns EMPTY_PROMPT reason for empty prompt', async () => {
      const result = await generateAiIllustration('');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('EMPTY_PROMPT');
      }
    });
  });
});
