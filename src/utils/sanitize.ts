const ZERO_WIDTH_SPACE = '\u200b';

export function sanitizeDiscordOutput(text: string): string {
  return text
    .replace(/@everyone/g, `@${ZERO_WIDTH_SPACE}everyone`)
    .replace(/@here/g, `@${ZERO_WIDTH_SPACE}here`)
    .replace(/<@!?(\d+)>/g, `<@${ZERO_WIDTH_SPACE}$1>`)
    .replace(/<@&(\d+)>/g, `<@&${ZERO_WIDTH_SPACE}$1>`);
}

/**
 * 🛡️ Chuẩn hóa Unicode và loại bỏ control characters / RTL overrides nguy hiểm
 */
export function sanitizeUnicodeInput(text: string): string {
  if (!text) return '';
  return (
    text
      .normalize('NFC')
      // Loại bỏ ký tự điều khiển ẩn và ký tự đảo ngược hướng văn bản RTL
      // eslint-disable-next-line no-control-regex -- Control characters là mục tiêu chủ đích của sanitizer
      .replace(/[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E]/g, '')
      .trim()
  );
}

/**
 * 🛡️ Kiểm tra văn bản có phải file text thuần túy không (phát hiện file nhị phân / null bytes)
 */
export function isPrintableText(content: string, minRatio = 0.85): boolean {
  if (!content || content.length === 0) return false;

  // Nếu chứa ký tự null byte -> chắc chắn là file nhị phân
  if (content.includes('\0')) return false;

  const sampleLength = Math.min(content.length, 1000);
  let printableCount = 0;

  for (let i = 0; i < sampleLength; i++) {
    const code = content.charCodeAt(i);
    // Tab (9), LF (10), CR (13), Printable ASCII (32-126), Extended Unicode (>= 128)
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126) || code >= 128) {
      printableCount++;
    }
  }

  return printableCount / sampleLength >= minRatio;
}
