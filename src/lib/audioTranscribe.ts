// Audio capture + transcription helpers.
//
// The old voice features relied on the browser Web Speech API
// (`webkitSpeechRecognition`), which is silently non-functional inside an
// installed standalone PWA on iOS — recognition starts then ends with no
// result. Here we instead record real microphone audio with MediaRecorder
// (which works fine in standalone PWAs) and transcribe it with Gemini.
//
// To stay compatible across browsers we always re-encode the recorded blob
// to 16 kHz mono WAV before sending: Safari records audio/mp4 and Chrome
// records audio/webm, but both decode fine via the Web Audio API, and Gemini
// reliably accepts audio/wav.

import { callGeminiChat } from './gemini';
import type { ChatTurn } from './gemini';
import { getAppLang } from './appLang';

// Sentinel the model returns when the audio contains no intelligible speech.
export const NO_SPEECH = '(無音)';
const NO_SPEECH_EN = '(no speech)';

/** Pick a MediaRecorder mime type the current browser actually supports. */
export function pickAudioMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/mpeg',
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return '';
}

/** True when the transcription is empty or the no-speech sentinel. */
export function isNoSpeech(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return /^[（(]?\s*(無音|silence|inaudible|no speech)\s*[)）]?$/i.test(t);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = () => reject(new Error('blob read failed'));
    reader.readAsDataURL(blob);
  });
}

/** Downmix to mono and linearly resample to the target sample rate. */
function toMonoResampled(buffer: AudioBuffer, targetRate: number): Float32Array {
  const numCh = buffer.numberOfChannels;
  const inLen = buffer.length;
  const mono = new Float32Array(inLen);
  for (let ch = 0; ch < numCh; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < inLen; i++) mono[i] += data[i] / numCh;
  }
  if (buffer.sampleRate === targetRate) return mono;

  const outLen = Math.max(1, Math.round((inLen * targetRate) / buffer.sampleRate));
  const out = new Float32Array(outLen);
  const ratio = inLen / outLen;
  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio;
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, inLen - 1);
    const frac = idx - i0;
    out[i] = mono[i0] * (1 - frac) + mono[i1] * frac;
  }
  return out;
}

/** Encode mono Float32 PCM samples to a 16-bit WAV blob. */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([view], { type: 'audio/wav' });
}

/** Decode any recorded audio blob and re-encode it to 16 kHz mono WAV base64. */
async function blobToWavBase64(blob: Blob, targetRate = 16000): Promise<string> {
  const arrayBuf = await blob.arrayBuffer();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
  const ctx = new AC();
  try {
    const audioBuf: AudioBuffer = await new Promise((resolve, reject) => {
      // Safari only supports the callback form of decodeAudioData reliably.
      ctx.decodeAudioData(arrayBuf.slice(0), resolve, reject);
    });
    const mono = toMonoResampled(audioBuf, targetRate);
    const wav = encodeWav(mono, targetRate);
    return blobToBase64(wav);
  } finally {
    try { await ctx.close(); } catch { /* ignore */ }
  }
}

function transcribePrompt(): string {
  if (getAppLang() === 'en') {
    return 'Transcribe the following audio accurately in the language being spoken. ' +
      'Omit filler words (um, uh, etc.) and add punctuation so the text reads naturally. ' +
      'Output ONLY the transcript — no preamble, explanation or symbols. ' +
      `If the audio is silent or unintelligible, output exactly "${NO_SPEECH_EN}" and nothing else.`;
  }
  return '次の音声を日本語で正確に文字起こししてください。' +
    'フィラー（えー、あの等）は省き、句読点を補って自然な文章にしてください。' +
    '文字起こししたテキストだけを出力し、前置き・説明・記号は一切付けないでください。' +
    `音声が無音または聞き取れない場合は、正確に「${NO_SPEECH}」とだけ出力してください。`;
}

/**
 * Transcribe a recorded audio blob with Gemini.
 * Returns the transcript, or the NO_SPEECH sentinel when nothing was heard.
 */
export async function transcribeAudioBlob(
  blob: Blob,
  apiKey: string,
  extraInstruction?: string,
): Promise<string> {
  const base64 = await blobToWavBase64(blob);
  const prompt = transcribePrompt();
  const history: ChatTurn[] = [
    {
      role: 'user',
      text: extraInstruction ? `${prompt}\n${extraInstruction}` : prompt,
      attachments: [{ mimeType: 'audio/wav', data: base64 }],
    },
  ];
  try {
    const text = await callGeminiChat(history, '', apiKey, {
      models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
      maxOutputTokens: 8192,
    });
    return text.trim();
  } catch {
    // callGeminiChat throws on an empty model response (e.g. pure silence).
    return NO_SPEECH;
  }
}
