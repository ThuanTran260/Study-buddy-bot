import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const openaiClient = env.aiApiKey ? new OpenAI({ apiKey: env.aiApiKey }) : null;
const geminiClient = env.aiApiKey ? new GoogleGenAI({ apiKey: env.aiApiKey }) : null;

const MERMAID_TIMEOUT_MS = 3000;
const MAX_IMAGE_BUFFER_BYTES = 2 * 1024 * 1024; // 2MB memory bound

/**
 * Gửi mã Mermaid tới QuickChart để render thành Buffer ảnh PNG.
 * Nếu timeout (>3s) hoặc lỗi, trả về null để kích hoạt cơ chế Fallback Markdown.
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
    const encoded = encodeURIComponent(cleanedCode);
    const url = `https://quickchart.io/mermaid?mermaid=${encoded}&format=png`;

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.warn('QuickChart returned non-200 status', { status: response.status });
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
    logger.warn('QuickChart Mermaid render failed or timed out, falling back to Markdown', {
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
