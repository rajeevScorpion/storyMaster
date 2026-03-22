// @ts-expect-error lamejs has no type definitions
import lamejs from 'lamejs';

/**
 * Compress a WAV base64 data URL to MP3 using lamejs.
 * Returns a data:audio/mpeg;base64,... string.
 */
export function compressWavToMp3(wavDataUrl: string): string {
  // Extract base64 data from data URL
  const base64 = wavDataUrl.split(',')[1];
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Parse WAV header
  const view = new DataView(bytes.buffer);
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);

  // Extract PCM data (starts at byte 44)
  const pcmData = bytes.slice(44);

  // Convert to Int16Array (lamejs expects 16-bit samples)
  let samples: Int16Array;
  if (bitsPerSample === 16) {
    samples = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.length / 2);
  } else {
    // 8-bit to 16-bit conversion
    samples = new Int16Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
      samples[i] = (pcmData[i] - 128) * 256;
    }
  }

  // Encode to MP3 (128kbps mono — clear for speech narration)
  const mp3Encoder = new lamejs.Mp3Encoder(channels, sampleRate, 128);
  const blockSize = 1152;
  const mp3Chunks: Uint8Array[] = [];

  for (let i = 0; i < samples.length; i += blockSize) {
    const chunk = samples.subarray(i, i + blockSize);
    const mp3buf = mp3Encoder.encodeBuffer(chunk);
    if (mp3buf.length > 0) {
      mp3Chunks.push(new Uint8Array(mp3buf));
    }
  }

  const endBuf = mp3Encoder.flush();
  if (endBuf.length > 0) {
    mp3Chunks.push(new Uint8Array(endBuf));
  }

  // Combine chunks and convert to base64
  const totalLength = mp3Chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const mp3Data = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of mp3Chunks) {
    mp3Data.set(chunk, offset);
    offset += chunk.length;
  }

  let binary = '';
  for (let i = 0; i < mp3Data.length; i++) {
    binary += String.fromCharCode(mp3Data[i]);
  }

  return `data:audio/mpeg;base64,${btoa(binary)}`;
}
