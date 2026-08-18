const ZERO_WIDTH_SPACE = '\u200b';

export function sanitizeDiscordOutput(text: string): string {
  return text
    .replace(/@everyone/g, `@${ZERO_WIDTH_SPACE}everyone`)
    .replace(/@here/g, `@${ZERO_WIDTH_SPACE}here`)
    .replace(/<@!?(\d+)>/g, `<@${ZERO_WIDTH_SPACE}$1>`)
    .replace(/<@&(\d+)>/g, `<@&${ZERO_WIDTH_SPACE}$1>`);
}
