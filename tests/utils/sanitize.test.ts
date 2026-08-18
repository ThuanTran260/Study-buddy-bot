import { sanitizeDiscordOutput } from '../../src/utils/sanitize';

describe('sanitizeDiscordOutput', () => {
  it('escapes @everyone and @here with zero-width space', () => {
    expect(sanitizeDiscordOutput('Hello @everyone')).toContain('@\u200beveryone');
    expect(sanitizeDiscordOutput('Hey @here')).toContain('@\u200bhere');
  });

  it('escapes user and role mentions', () => {
    expect(sanitizeDiscordOutput('<@123456789012345678>')).toBe('<@\u200b123456789012345678>');
    expect(sanitizeDiscordOutput('<@&123456789012345678>')).toBe('<@&\u200b123456789012345678>');
  });

  it('preserves clean text untouched', () => {
    expect(sanitizeDiscordOutput('Học lập trình TypeScript rất vui!')).toBe('Học lập trình TypeScript rất vui!');
  });
});
