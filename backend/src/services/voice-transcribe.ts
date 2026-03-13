/**
 * Transcribe audio to text using OpenAI Whisper API.
 * Accepts base64-encoded audio; returns plain text.
 */

const MAX_FILE_SIZE_BYTES = 24 * 1024 * 1024; // 24 MB (API limit 25 MB)

function extensionFromMime(mimeType: string): string {
  const m = (mimeType || '').toLowerCase().split(';')[0].trim();
  const map: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/flac': 'flac',
    'audio/x-m4a': 'm4a',
  };
  return map[m] || 'webm';
}

export interface TranscribeConfig {
  apiKey: string;
  /** Base URL for chat/completions; may not support Whisper. */
  baseURL?: string;
  /** Base URL for Whisper (e.g. https://api.openai.com). Use when baseURL is a proxy that 404s on /v1/audio/transcriptions. */
  whisperBaseURL?: string;
}

/**
 * Transcribe audio (base64) to text using Whisper.
 * Uses Node 18+ global FormData and File.
 */
export async function transcribeAudio(
  config: TranscribeConfig,
  audioBase64: string,
  mimeType: string = 'audio/webm'
): Promise<string> {
  const buffer = Buffer.from(audioBase64, 'base64');
  if (buffer.length === 0) {
    throw new Error('Audio data is empty.');
  }
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new Error(`Audio file too large (max ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB).`);
  }

  const defaultOpenAI = 'https://api.openai.com';
  let whisperBase = config.whisperBaseURL ?? config.baseURL ?? defaultOpenAI;
  if (whisperBase && !config.whisperBaseURL && !/^https:\/\/api\.openai\.com(\/|$)/i.test(whisperBase)) {
    whisperBase = defaultOpenAI;
  }
  whisperBase = whisperBase.replace(/\/$/, '');
  const url = `${whisperBase}/v1/audio/transcriptions`;
  const ext = extensionFromMime(mimeType);
  const filename = `audio.${ext}`;

  const formData = new FormData();
  const blob = new Blob([buffer], { type: mimeType });
  formData.append('file', blob, filename);
  formData.append('model', 'whisper-1');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Whisper API error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as { text?: string };
  const text = typeof data.text === 'string' ? data.text.trim() : '';
  return text;
}
