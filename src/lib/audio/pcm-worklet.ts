/**
 * AudioWorklet processor: downsamples mic input to 16kHz mono int16 PCM and
 * posts the chunks back to the main thread for forwarding over WebSocket.
 *
 * Shipped as a source string so we can register it via a Blob URL — that
 * avoids needing a separate static asset and works under Vite + SSR.
 *
 * The browser's default AudioContext sample rate is usually 48000 Hz on
 * desktop / 44100 on some macs / 16000-48000 on mobile. We downsample to
 * exactly 16kHz because AssemblyAI Universal-Streaming expects pcm_s16le @
 * 16kHz.
 */

export const PCM_WORKLET_SOURCE = /* js */ `
class PcmDownsamplerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.targetSampleRate = opts.targetSampleRate || 16000;
    this.sourceSampleRate = sampleRate; // global in worklet scope
    this.ratio = this.sourceSampleRate / this.targetSampleRate;
    this.buffer = [];
    // Emit ~100ms of audio per message: 1600 samples at 16kHz.
    this.framesPerMessage = Math.floor(this.targetSampleRate / 10);
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel) return true;

    // Linear downsample. Quality is fine for speech transcription; full
    // resample would need a low-pass filter but adds CPU and AssemblyAI
    // handles the aliasing well in practice.
    for (let i = 0; i < channel.length; i += this.ratio) {
      const idx = Math.floor(i);
      let s = channel[idx];
      if (s > 1) s = 1;
      if (s < -1) s = -1;
      // float -> int16 little-endian; multiplying by 0x7FFF clips at 1.0
      this.buffer.push(s < 0 ? s * 0x8000 : s * 0x7FFF);
    }

    while (this.buffer.length >= this.framesPerMessage) {
      const chunk = this.buffer.splice(0, this.framesPerMessage);
      const int16 = new Int16Array(chunk);
      // Transfer the underlying ArrayBuffer for zero-copy postMessage.
      this.port.postMessage(int16.buffer, [int16.buffer]);
    }
    return true;
  }
}

registerProcessor('pcm-downsampler', PcmDownsamplerProcessor);
`;

/**
 * Returns a Blob URL pointing to the worklet source. Cache the URL per
 * AudioContext — re-registering is fine but wasteful.
 */
export function createPcmWorkletUrl(): string {
  const blob = new Blob([PCM_WORKLET_SOURCE], { type: "application/javascript" });
  return URL.createObjectURL(blob);
}
