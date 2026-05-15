import { describe, it, expect } from "vitest";
import { buildAudioKey, extensionFromMime } from "../r2";

describe("buildAudioKey", () => {
  it("uses the safe extension form: <userId>/<meetingId>/original.<ext>", () => {
    const key = buildAudioKey("user_abc", "mtg_123", "mp3");
    expect(key).toBe("user_abc/mtg_123/original.mp3");
  });

  it("strips non-alphanumerics from the extension", () => {
    const key = buildAudioKey("u", "m", "m.p3!");
    expect(key).toBe("u/m/original.mp3");
  });

  it("falls back to 'bin' when extension is empty or all garbage", () => {
    expect(buildAudioKey("u", "m", "")).toBe("u/m/original.bin");
    expect(buildAudioKey("u", "m", "!!!")).toBe("u/m/original.bin");
  });

  it("lowercases the extension", () => {
    expect(buildAudioKey("u", "m", "MP3")).toBe("u/m/original.mp3");
  });
});

describe("extensionFromMime", () => {
  it("maps known audio mime types", () => {
    expect(extensionFromMime("audio/mpeg")).toBe("mp3");
    expect(extensionFromMime("audio/wav")).toBe("wav");
    expect(extensionFromMime("audio/x-wav")).toBe("wav");
    expect(extensionFromMime("audio/m4a")).toBe("m4a");
    expect(extensionFromMime("audio/x-m4a")).toBe("m4a");
    expect(extensionFromMime("audio/webm")).toBe("webm");
  });

  it("maps known video mime types", () => {
    expect(extensionFromMime("video/mp4")).toBe("mp4");
    expect(extensionFromMime("video/webm")).toBe("webm");
  });

  it("falls back to 'bin' for unknown types", () => {
    expect(extensionFromMime("application/octet-stream")).toBe("bin");
    expect(extensionFromMime("")).toBe("bin");
  });
});
