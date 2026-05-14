export const requestId = async (c, next) => {
    const id = c.req.header("x-request-id") ?? crypto.randomUUID();
    c.set("requestId", id);
    c.header("x-request-id", id);
    await next();
};
//# sourceMappingURL=request-id.js.map