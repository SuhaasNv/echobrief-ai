/**
 * LiveRecorder — owns the entire mic → AssemblyAI + MediaRecorder pipeline.
 *
 * Two parallel data flows from a single getUserMedia stream:
 *
 *   1. AudioContext → AudioWorkletNode (PCM downsampler) → WebSocket frames
 *      to AssemblyAI for real-time transcription.
 *
 *   2. MediaRecorder → opus/webm Blob accumulated in memory, uploaded to R2
 *      on stop() so the meeting has a playable audio file.
 *
 * Event model is EventTarget-based so React components can subscribe via
 * `recorder.addEventListener("partial", handler)`. We don't use Observable
 * libs to keep the bundle small.
 *
 * Browser support: AudioWorklet is required (Chrome 66+, Safari 16+, Firefox
 * 76+). MediaRecorder is everywhere. iOS Safari needs the AudioContext
 * created/resumed inside a user gesture — start() must be called from a
 * click handler.
 */

import { createPcmWorkletUrl } from "./pcm-worklet";

export type RecorderState =
  | "idle"
  | "permission"
  | "starting"
  | "recording"
  | "paused"
  | "stopping"
  | "stopped"
  | "error";

export interface TranscriptSegment {
  /** Local incrementing id so React can key the list. */
  id: number;
  text: string;
  /** True once AssemblyAI sent end_of_turn=true for this turn. */
  final: boolean;
  /** Approximate seconds into the recording when this turn started. */
  start_sec: number;
}

export interface RecorderResult {
  /** Final audio blob, ready to PUT to R2. */
  blob: Blob;
  /** MIME of the blob (depends on browser). */
  mime: string;
  /** Total wall-clock recording duration in seconds (excludes paused time). */
  durationSec: number;
  /** Concatenated final transcript text. */
  transcript: string;
}

interface RecorderOptions {
  /** Async callback returning a fresh AssemblyAI token. Called on start
   *  and on token-expiry mid-session. */
  fetchToken: () => Promise<{ token: string; ws_url: string }>;
  /** Audio sample rate to negotiate with AssemblyAI. Default 16000. */
  sampleRate?: number;
  /** Browser audio MIME preference. Falls back automatically. */
  preferredMime?: string;
}

const EVENT_TARGETS = {
  state: "state",
  partial: "partial",
  final: "final",
  level: "level",
  error: "error",
} as const;

function pickRecorderMime(preferred?: string): string {
  const candidates = [
    preferred,
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2", // Safari fallback
    "audio/mp4",
  ].filter(Boolean) as string[];
  for (const m of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) {
      return m;
    }
  }
  return "audio/webm";
}

export class LiveRecorder extends EventTarget {
  state: RecorderState = "idle";
  private opts: RecorderOptions;
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private ws: WebSocket | null = null;
  private wsUrl = "";
  private blobChunks: BlobPart[] = [];
  private blobMime = "audio/webm";
  private segments: TranscriptSegment[] = [];
  private nextSegmentId = 0;
  private currentTurnId = -1;
  private startedAt = 0;
  private accumulatedMs = 0;
  private workletUrl: string | null = null;
  private destroyed = false;

  constructor(opts: RecorderOptions) {
    super();
    this.opts = opts;
  }

  /** Snapshot of segments so React can render. */
  getSegments(): readonly TranscriptSegment[] {
    return this.segments;
  }

  private setState(s: RecorderState) {
    this.state = s;
    this.dispatchEvent(new CustomEvent(EVENT_TARGETS.state, { detail: s }));
  }

  private emitError(message: string, recoverable = false): void {
    // Release the mic + audio context + WebSocket on any terminal error.
    // Otherwise the browser keeps the mic light on even though we've
    // shown the user an error and can't continue from this state.
    this.cleanup();
    this.setState("error");
    this.dispatchEvent(new CustomEvent(EVENT_TARGETS.error, { detail: { message, recoverable } }));
  }

  async start(): Promise<void> {
    if (this.state !== "idle" && this.state !== "error") {
      throw new Error(`Cannot start from state ${this.state}`);
    }
    this.setState("permission");

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone permission denied. Grant access and try again."
          : err instanceof Error
            ? err.message
            : "Could not access microphone";
      this.emitError(message, false);
      throw err;
    }

    this.setState("starting");

    try {
      await this.setupAudioPipeline();
      await this.connectWebSocket();
      this.setupMediaRecorder();
    } catch (err) {
      this.emitError(err instanceof Error ? err.message : "Recorder setup failed", false);
      this.cleanup();
      throw err;
    }

    this.startedAt = Date.now();
    this.accumulatedMs = 0;
    this.setState("recording");
  }

  private async setupAudioPipeline(): Promise<void> {
    const sampleRate = this.opts.sampleRate ?? 16000;
    // AudioContext doesn't accept any sample rate on all browsers — pass it
    // as a hint, the browser may use a different rate.
    this.audioCtx = new (
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    )({
      sampleRate,
    });
    await this.audioCtx.resume();

    if (!this.workletUrl) this.workletUrl = createPcmWorkletUrl();
    await this.audioCtx.audioWorklet.addModule(this.workletUrl);

    const source = this.audioCtx.createMediaStreamSource(this.stream!);
    this.workletNode = new AudioWorkletNode(this.audioCtx, "pcm-downsampler", {
      processorOptions: { targetSampleRate: sampleRate },
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
    });

    // Audio-level metering: peek at the first frame of each port message.
    let chunksSent = 0;
    this.workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (this.state !== "recording") return;
      const buf = e.data;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(buf);
        chunksSent++;
        if (chunksSent === 1 || chunksSent % 50 === 0) {
          console.debug(
            "[live-recorder] audio chunks sent",
            chunksSent,
            `(${buf.byteLength}B each)`,
          );
        }
      } else if (this.ws) {
        console.warn("[live-recorder] tried to send audio but WS not open", this.ws.readyState);
      }
      // RMS over the chunk for the VU meter, normalized 0..1.
      const int = new Int16Array(buf);
      let sumSq = 0;
      for (let i = 0; i < int.length; i++) {
        const v = int[i] / 0x8000;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / int.length);
      this.dispatchEvent(new CustomEvent(EVENT_TARGETS.level, { detail: Math.min(rms * 4, 1) }));
    };

    source.connect(this.workletNode);
    // The worklet must be connected to the destination or browsers will
    // optimize it away and process() never fires. Route through a silent
    // gain so we get processing without audible feedback.
    const silent = this.audioCtx.createGain();
    silent.gain.value = 0;
    this.workletNode.connect(silent);
    silent.connect(this.audioCtx.destination);
  }

  private async connectWebSocket(): Promise<void> {
    const { token, ws_url } = await this.opts.fetchToken();
    const sampleRate = this.opts.sampleRate ?? 16000;
    const url = `${ws_url}?token=${encodeURIComponent(token)}&sample_rate=${sampleRate}&encoding=pcm_s16le&speech_model=universal-streaming-multilingual`;
    this.wsUrl = ws_url;

    console.debug("[live-recorder] connecting WS", { sampleRate, wsHost: new URL(url).host });

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      const onOpenTimeout = setTimeout(() => {
        ws.close();
        reject(new Error("WebSocket open timed out after 10s"));
      }, 10_000);

      ws.binaryType = "arraybuffer";
      ws.addEventListener("open", () => {
        console.debug("[live-recorder] WS open");
        clearTimeout(onOpenTimeout);
        resolve();
      });
      ws.addEventListener("message", (e) => this.handleWsMessage(e));
      ws.addEventListener("error", (ev) => {
        console.error("[live-recorder] WS error", ev);
        if (this.state === "starting") {
          clearTimeout(onOpenTimeout);
          reject(new Error("Could not connect to transcription service"));
        }
      });
      ws.addEventListener("close", (e) => this.handleWsClose(e));
    });
  }

  private handleWsMessage(e: MessageEvent): void {
    if (typeof e.data !== "string") return; // ignore binary echoes
    let msg: {
      type?: string;
      transcript?: string;
      end_of_turn?: boolean;
      code?: string;
      message?: string;
      error?: string;
    };
    try {
      msg = JSON.parse(e.data) as typeof msg;
    } catch (err) {
      console.warn("[live-recorder] non-JSON message", e.data, err);
      return;
    }
    console.debug("[live-recorder] msg", msg);

    // Any structured message from the server means the WS handshake worked.
    // Mark connected on the first message we get instead of requiring exactly
    // "Begin" — AssemblyAI's v3 API has shipped variants that don't always
    // open with a Begin event.
    this.dispatchEvent(new CustomEvent("connected", { detail: true }));

    // Catch any error-shaped message regardless of `type` — AssemblyAI's v3
    // API has shipped variants where the error arrives as "Error" (Pascal),
    // "error" (lower), or simply a payload with an `error`/`code` field and
    // no type. Surface the first one we see — emitError calls cleanup() so
    // the mic is released immediately.
    if (msg.type === "Error" || msg.type === "error" || msg.error || (msg.code && msg.message)) {
      const detail = msg.message ?? msg.error ?? `code ${msg.code ?? "unknown"}`;
      this.emitError(`Transcription error: ${detail}`, false);
      return;
    }

    switch (msg.type) {
      case "Begin":
        // Already dispatched "connected" above. Keep the case so we don't
        // hit the default branch with a warning.
        break;
      case "Turn": {
        const text = (msg.transcript ?? "").trim();
        if (!text) break;
        const isFinal = msg.end_of_turn === true;
        if (this.currentTurnId < 0) {
          // New turn beginning.
          this.currentTurnId = this.nextSegmentId++;
          const startSec = Math.floor(this.elapsedMs() / 1000);
          this.segments = [
            ...this.segments,
            { id: this.currentTurnId, text, final: false, start_sec: startSec },
          ];
        } else {
          this.segments = this.segments.map((s) =>
            s.id === this.currentTurnId ? { ...s, text, final: isFinal } : s,
          );
        }
        if (isFinal) {
          this.dispatchEvent(
            new CustomEvent(EVENT_TARGETS.final, { detail: { text, id: this.currentTurnId } }),
          );
          this.currentTurnId = -1;
        } else {
          this.dispatchEvent(
            new CustomEvent(EVENT_TARGETS.partial, { detail: { text, id: this.currentTurnId } }),
          );
        }
        break;
      }
      case "Termination":
        // Session ended cleanly. Nothing more to receive.
        break;
    }
  }

  private handleWsClose(e: CloseEvent): void {
    console.debug("[live-recorder] WS close", {
      code: e.code,
      reason: e.reason,
      wasClean: e.wasClean,
      state: this.state,
    });
    if (this.state === "stopping" || this.state === "stopped") return;
    // If AssemblyAI already sent a specific error message JUST before the
    // close, emitError has already fired and state is now "error". Don't
    // overwrite the specific message with the generic close-code copy.
    if (this.state === "error") return;
    const code = e.code || "unknown";
    const reason = e.reason ? ` — ${e.reason}` : "";
    this.emitError(
      `Transcription disconnected (code ${code}${reason}). Check your AssemblyAI plan or try again.`,
      true,
    );
  }

  private setupMediaRecorder(): void {
    if (!this.stream) return;
    this.blobMime = pickRecorderMime(this.opts.preferredMime);
    this.mediaRecorder = new MediaRecorder(this.stream, {
      mimeType: this.blobMime,
      audioBitsPerSecond: 64_000,
    });
    this.mediaRecorder.addEventListener("dataavailable", (e) => {
      if (e.data && e.data.size > 0) this.blobChunks.push(e.data);
    });
    this.mediaRecorder.start(1000); // emit a chunk per second
  }

  pause(): void {
    if (this.state !== "recording") return;
    this.accumulatedMs += Date.now() - this.startedAt;
    this.mediaRecorder?.pause();
    this.audioCtx?.suspend();
    this.setState("paused");
  }

  async resume(): Promise<void> {
    if (this.state !== "paused") return;
    this.startedAt = Date.now();
    await this.audioCtx?.resume();
    this.mediaRecorder?.resume();
    this.setState("recording");
  }

  async stop(): Promise<RecorderResult> {
    if (this.state === "idle" || this.state === "stopped") {
      throw new Error(`Cannot stop from state ${this.state}`);
    }
    this.setState("stopping");

    // Tell AssemblyAI we're done so it flushes any pending turn.
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: "Terminate" }));
      } catch {
        /* best-effort */
      }
    }

    const finalBlob: Blob = await new Promise((resolve) => {
      if (!this.mediaRecorder) {
        resolve(new Blob(this.blobChunks, { type: this.blobMime }));
        return;
      }
      const onStop = () => {
        this.mediaRecorder?.removeEventListener("stop", onStop);
        resolve(new Blob(this.blobChunks, { type: this.blobMime }));
      };
      this.mediaRecorder.addEventListener("stop", onStop);
      if (this.mediaRecorder.state !== "inactive") this.mediaRecorder.stop();
      else resolve(new Blob(this.blobChunks, { type: this.blobMime }));
    });

    const totalMs =
      this.state === "paused"
        ? this.accumulatedMs
        : this.accumulatedMs + (Date.now() - this.startedAt);
    const result: RecorderResult = {
      blob: finalBlob,
      mime: this.blobMime,
      durationSec: Math.max(1, Math.round(totalMs / 1000)),
      transcript: this.segments
        .filter((s) => s.final || s.text.length > 0)
        .map((s) => s.text)
        .join(" ")
        .trim(),
    };

    this.cleanup();
    this.setState("stopped");
    return result;
  }

  private elapsedMs(): number {
    if (this.state === "paused") return this.accumulatedMs;
    if (this.state === "recording") return this.accumulatedMs + (Date.now() - this.startedAt);
    return this.accumulatedMs;
  }

  private cleanup(): void {
    if (this.destroyed) return;
    // Order matters: stop any active recorder first so it releases its
    // reference to the MediaStream, THEN stop the stream tracks so the
    // browser's mic indicator turns off. If we stop tracks first while
    // MediaRecorder is still active, some browsers leak the mic.
    try {
      if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
        this.mediaRecorder.stop();
      }
    } catch {
      /* ignore */
    }
    try {
      this.workletNode?.port.close();
    } catch {
      /* ignore */
    }
    try {
      this.workletNode?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.audioCtx?.close();
    } catch {
      /* ignore */
    }
    // Stop every track so the browser's "recording" indicator clears.
    try {
      this.stream?.getTracks().forEach((t) => {
        t.stop();
        // Detach from any associated MediaStream so nothing else (e.g.
        // a paused MediaRecorder we couldn't stop above) keeps it alive.
        this.stream?.removeTrack(t);
      });
    } catch {
      /* ignore */
    }
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    if (this.workletUrl) {
      URL.revokeObjectURL(this.workletUrl);
      this.workletUrl = null;
    }
    this.workletNode = null;
    this.audioCtx = null;
    this.mediaRecorder = null;
    this.stream = null;
    this.ws = null;
  }

  destroy(): void {
    this.cleanup();
    this.destroyed = true;
  }
}
