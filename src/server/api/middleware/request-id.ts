import type { MiddlewareHandler } from "hono";
import type { AppBindings } from "../types";

export const requestId: MiddlewareHandler<AppBindings> = async (c, next) => {
  const id = c.req.header("x-request-id") ?? crypto.randomUUID();
  c.set("requestId", id);
  c.header("x-request-id", id);
  await next();
};
