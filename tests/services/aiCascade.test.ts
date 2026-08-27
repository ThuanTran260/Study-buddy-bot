import {
  extractHttpStatus,
  isCascadeRetryable,
  resolveCandidateModels,
  GEMINI_DEFAULT_MODELS,
  OPENAI_DEFAULT_MODELS,
} from '../../src/services/aiService';

describe('AI Cascade & Error Classification Logic', () => {
  describe('extractHttpStatus', () => {
    it('extracts numeric status from direct status property', () => {
      expect(extractHttpStatus({ status: 503 })).toBe(503);
      expect(extractHttpStatus({ status: 401 })).toBe(401);
    });

    it('extracts numeric status from nested error.code or error.status', () => {
      expect(extractHttpStatus({ error: { code: 429 } })).toBe(429);
      expect(extractHttpStatus({ code: 500 })).toBe(500);
    });

    it('extracts status code from error message JSON string', () => {
      const err = new Error('ApiError: {"error":{"code":503,"message":"High demand"}}');
      expect(extractHttpStatus(err)).toBe(503);
    });

    it('extracts status code from plain message string', () => {
      const err = new Error('Failed with 404 Not Found');
      expect(extractHttpStatus(err)).toBe(404);
    });

    it('returns null when no status code is present', () => {
      expect(extractHttpStatus(new Error('Generic network failure'))).toBeNull();
      expect(extractHttpStatus('unknown error')).toBeNull();
    });
  });

  describe('isCascadeRetryable', () => {
    it('fails fast on permanent non-retryable errors (401, 403, 400)', () => {
      expect(isCascadeRetryable(401, 0)).toBe(false);
      expect(isCascadeRetryable(403, 0)).toBe(false);
      expect(isCascadeRetryable(400, 0)).toBe(false);
    });

    it('allows cascade retry on transient/server errors (503, 502, 504, 500, 404)', () => {
      expect(isCascadeRetryable(503, 0)).toBe(true);
      expect(isCascadeRetryable(503, 1)).toBe(true);
      expect(isCascadeRetryable(502, 0)).toBe(true);
      expect(isCascadeRetryable(504, 0)).toBe(true);
      expect(isCascadeRetryable(500, 0)).toBe(true);
      expect(isCascadeRetryable(404, 0)).toBe(true);
    });

    it('allows at most 1 retry attempt on 429 to prevent spamming', () => {
      expect(isCascadeRetryable(429, 0)).toBe(true);
      expect(isCascadeRetryable(429, 1)).toBe(false);
      expect(isCascadeRetryable(429, 2)).toBe(false);
    });

    it('allows 1 retry on unknown status', () => {
      expect(isCascadeRetryable(null, 0)).toBe(true);
      expect(isCascadeRetryable(null, 1)).toBe(false);
    });
  });

  describe('resolveCandidateModels', () => {
    it('returns Gemini models without mixing OpenAI models when provider is gemini', () => {
      const models = resolveCandidateModels('gemini', 'gpt-4o-mini');
      expect(models).toEqual(GEMINI_DEFAULT_MODELS);
      expect(models).not.toContain('gpt-4o-mini');
    });

    it('prepends valid gemini model when explicitly configured', () => {
      const models = resolveCandidateModels('gemini', 'gemini-2.5-pro');
      expect(models[0]).toBe('gemini-2.5-pro');
      expect(models).toContain('gemini-3.6-flash');
    });

    it('returns OpenAI models without mixing Gemini models when provider is openai', () => {
      const models = resolveCandidateModels('openai', 'gemini-3.6-flash');
      expect(models).toEqual(OPENAI_DEFAULT_MODELS);
      expect(models).not.toContain('gemini-3.6-flash');
    });

    it('prepends valid openai model when explicitly configured', () => {
      const models = resolveCandidateModels('openai', 'gpt-4-turbo');
      expect(models[0]).toBe('gpt-4-turbo');
      expect(models).toContain('gpt-4o-mini');
    });
  });
});
