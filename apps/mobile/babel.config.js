module.exports = function (api) {
  api.cache(true);

  return {
    presets: ["babel-preset-expo"],
    plugins: [
      // Reanimated 4 split its worklet runtime into react-native-worklets.
      // This replaces the old 'react-native-reanimated/plugin' and MUST stay
      // last in the list.
      "react-native-worklets/plugin",
    ],
  };
};
