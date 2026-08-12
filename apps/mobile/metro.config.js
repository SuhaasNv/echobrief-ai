// Learn more: https://docs.expo.dev/guides/monorepos/
//
// Expo SDK 56+ resolves workspace packages automatically (on-demand filesystem
// + autolinking dedup), so the historical watchFolders/nodeModulesPaths
// boilerplate is not needed here. @echobrief/shared is consumed as TypeScript
// source, which Metro transpiles like any other module.
const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

const config = getDefaultConfig(__dirname);

module.exports = withUniwindConfig(config, {
  cssEntryFile: "./global.css",
  // Generates className autocompletion + type-checking for our theme tokens.
  dtsFile: "./uniwind-env.d.ts",
});
