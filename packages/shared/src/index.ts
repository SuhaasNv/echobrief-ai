/**
 * @echobrief/shared — platform-agnostic code shared by the web app, the Hono
 * API, and the Expo iOS app.
 *
 * Everything exported here must run unchanged on Node, in a browser, and under
 * Hermes. No DOM globals, no Node built-ins, no React Native imports.
 */

export * from "./schemas";
export * from "./ask-actions";
