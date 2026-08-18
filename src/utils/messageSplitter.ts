export function splitMessage(text: string, maxLength: number = 2000): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf('\n\n', maxLength);
    if (splitAt <= 0) splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt <= 0) splitAt = remaining.lastIndexOf(' ', maxLength);
    if (splitAt <= 0) splitAt = maxLength;

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }
  return chunks;
}

export function splitForEmbedAndFollowUp(text: string): { embedChunk: string; followUpChunks: string[] } {
  if (text.length <= 4000) {
    return { embedChunk: text, followUpChunks: [] };
  }

  const allChunks = splitMessage(text, 4000);
  const embedChunk = allChunks[0];
  const remainingText = allChunks.slice(1).join('\n\n');
  const followUpChunks = remainingText ? splitMessage(remainingText, 2000) : [];

  return { embedChunk, followUpChunks };
}
