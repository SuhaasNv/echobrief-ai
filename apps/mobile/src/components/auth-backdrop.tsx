import { useEffect } from "react";
import { View, useWindowDimensions } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeIn, useReducedMotion } from "react-native-reanimated";

/**
 * Video hero for the auth screens.
 *
 * Occupies the top portion of the screen only, so the form below sits on solid
 * ground. The first pass laid the form over the video with a heavy scrim: the
 * scrim had to be dark enough to protect input contrast, which dulled the
 * footage to the point of being pointless. Splitting the screen means the video
 * can play at full strength and the form keeps its verified contrast ratios —
 * neither is compromised for the other.
 *
 * The gradient at the bottom does the joining. Without it there is a visible
 * hard edge where the video ends.
 */

/** Share of screen height given to the video. */
const HERO_RATIO = 0.5;

export function AuthBackdrop() {
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const heroHeight = height * HERO_RATIO;

  const player = useVideoPlayer(require("../../assets/video/auth-orb.mp4"), (p) => {
    p.loop = true;
    p.muted = true;
    // Never take the audio session from playback elsewhere on the device.
    p.audioMixingMode = "mixWithOthers";
  });

  useEffect(() => {
    if (reduceMotion) {
      // Looping ambient video is exactly what this setting exists to stop.
      // Hold the first frame instead of removing the visual entirely.
      player.pause();
      return;
    }
    player.play();
  }, [player, reduceMotion]);

  return (
    <View
      style={{ position: "absolute", top: 0, left: 0, right: 0, height: heroHeight }}
      pointerEvents="none"
    >
      <Animated.View entering={FadeIn.duration(700)} style={{ flex: 1 }}>
        <VideoView
          style={{ width, height: heroHeight }}
          player={player}
          contentFit="cover"
          nativeControls={false}
          // Decorative; the form carries all the accessible content.
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      </Animated.View>

      {/* Bottom fade into the canvas. Tall enough (45% of the hero) to read as a
          dissolve rather than a band, and it ends fully opaque so there is no
          seam against the form area. */}
      <LinearGradient
        colors={["transparent", "rgba(6,7,10,0.75)", "#06070A"]}
        locations={[0, 0.65, 1]}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: heroHeight * 0.45,
        }}
      />
    </View>
  );
}

export const AUTH_HERO_RATIO = HERO_RATIO;
