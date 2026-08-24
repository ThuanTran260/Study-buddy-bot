import zlib from 'zlib';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const openaiClient = env.aiApiKey ? new OpenAI({ apiKey: env.aiApiKey }) : null;
const geminiClient = env.aiApiKey ? new GoogleGenAI({ apiKey: env.aiApiKey }) : null;

const MERMAID_TIMEOUT_MS = 5000;
const MAX_IMAGE_BUFFER_BYTES = 2 * 1024 * 1024; // 2MB memory bound

/**
 * Tự động bóc tách khối mã Mermaid từ câu trả lời văn bản của AI
 */
export function extractMermaidCode(text: string): string | null {
  if (!text) return null;

  // 1. Tìm trong khối code ```mermaid ... ```
  const blockMatch = text.match(/```mermaid\s*([\s\S]*?)```/i);
  if (blockMatch && blockMatch[1].trim()) {
    return blockMatch[1].trim();
  }

  // 2. Tìm khối bắt đầu bằng từ khóa Mermaid kinh điển
  const keywords = [
    'sequenceDiagram',
    'flowchart TD',
    'flowchart LR',
    'flowchart TB',
    'flowchart RL',
    'graph TD',
    'graph LR',
    'graph TB',
    'classDiagram',
    'stateDiagram',
    'erDiagram',
    'gantt',
    'pie',
  ];

  for (const kw of keywords) {
    const idx = text.indexOf(kw);
    if (idx !== -1) {
      let candidate = text.slice(idx);
      const endBacktick = candidate.indexOf('```');
      if (endBacktick !== -1) {
        candidate = candidate.slice(0, endBacktick);
      }
      return candidate.trim();
    }
  }

  return null;
}

/**
 * Gửi mã Mermaid tới Mermaid.ink (chuẩn Pako Deflate) để render thành Buffer ảnh PNG/JPEG.
 * Hỗ trợ 100% tiếng Việt UTF-8 và các sơ đồ Sequence phức tạp.
 * Nếu timeout (>5s) hoặc lỗi cú pháp, trả về null để kích hoạt Fallback Markdown.
 */
export async function renderMermaidToBuffer(mermaidCode: string): Promise<Buffer | null> {
  const cleanedCode = mermaidCode
    .replace(/^```mermaid\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  if (!cleanedCode) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MERMAID_TIMEOUT_MS);

  try {
    const state = JSON.stringify({ code: cleanedCode, mermaid: { theme: 'default' } });
    const deflated = zlib.deflateSync(Buffer.from(state, 'utf8'), { level: 9 });
    const pakoBase64 = deflated.toString('base64url');
    const url = `https://mermaid.ink/img/pako:${pakoBase64}?bgColor=white`;

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.warn('Mermaid.ink returned non-200 status', { status: response.status });
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.byteLength > MAX_IMAGE_BUFFER_BYTES) {
      logger.warn('Mermaid image exceeds max buffer size', { size: buffer.byteLength });
      return null;
    }

    return buffer;
  } catch (error: any) {
    logger.warn('Mermaid.ink render failed or timed out, falling back to Markdown', {
      error: error.message || String(error),
    });
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Tạo ảnh minh họa AI bằng Google Imagen 3 hoặc OpenAI DALL-E 3.
 * Trả về Buffer ảnh JPEG/PNG hoặc null nếu lỗi/safety block.
 */
export async function generateAiIllustration(prompt: string): Promise<Buffer | null> {
  const safePrompt = prompt.slice(0, 1000).trim();
  if (!safePrompt) return null;

  try {
    if (env.aiProvider === 'gemini' && geminiClient) {
      // Gọi Imagen 3 qua Google GenAI SDK
      const response = await (geminiClient.models as any).generateImages({
        model: 'imagen-3.0-generate-002',
        prompt: `Educational study illustration: ${safePrompt}`,
        config: {
          numberOfImages: 1,
          outputMimeType: 'image/jpeg',
          aspectRatio: '1:1',
        },
      });

      const base64Image = response?.generatedImages?.[0]?.image?.imageBytes;
      if (base64Image) {
        const buffer = Buffer.from(base64Image, 'base64');
        if (buffer.byteLength <= MAX_IMAGE_BUFFER_BYTES) {
          return buffer;
        }
      }
    } else if (openaiClient) {
      // Gọi DALL-E qua OpenAI SDK
      const response = await openaiClient.images.generate({
        model: 'dall-e-3',
        prompt: `Educational study illustration: ${safePrompt}`,
        n: 1,
        size: '1024x1024',
        response_format: 'b64_json',
      });

      const b64Json = response?.data?.[0]?.b64_json;
      if (b64Json) {
        const buffer = Buffer.from(b64Json, 'base64');
        if (buffer.byteLength <= MAX_IMAGE_BUFFER_BYTES) {
          return buffer;
        }
      }
    }

    return null;
  } catch (error: any) {
    logger.error('Failed to generate AI illustration', {
      prompt: safePrompt.slice(0, 100),
      error: error.message || String(error),
    });
    return null;
  }
}
