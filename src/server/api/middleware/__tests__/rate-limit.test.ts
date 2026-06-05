import { afterEach, describe, expect, it, vi } from "vitest";
import * as redisService from "@/server/services/redis";
import { checkAuthRateLimit, rateLimit } from "../rate-limit";

describe("rate-limit test env bypass", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  it("skips middleware rate limiting in test env", async () => {
    process.env.NODE_ENV = "test";
    const getRedisSpy = vi.spyOn(redisService, "getRedis");
    const next = vi.fn().mockResolvedValue(undefined);

    await rateLimit("general")({} as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(getRedisSpy).not.toHaveBeenCalled();
  });

  it("skips auth rate limiting in test env", async () => {
    process.env.NODE_ENV = "test";
    const getRedisSpy = vi.spyOn(redisService, "getRedis");

    const res = await checkAuthRateLimit({} as never, "signup", "user@test.local");

    expect(res).toBeNull();
    expect(getRedisSpy).not.toHaveBeenCalled();
  });
});
