import { useEffect } from "react";
import { AppState, View, useWindowDimensions } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeIn, useReducedMotion } from "react-native-reanimated";
import { useIsFocused } from "expo-router";

/**
 * Video hero for the auth screens.
 *
 * The form is NOT laid over the video. An earlier pass did that and the scrim
 * needed to protect input contrast dulled the footage to the point of being
 * pointless. Instead the video occupies the top of the screen and dissolves
 * into the canvas above the form, so the footage plays at full strength and
 * the form keeps its verified contrast ratios.
 *
 * What this version fixes: the hero was a fixed 62% of the screen with the
 * video centre-cropped inside it, so where the orb landed was an accident of
 * the device's aspect ratio, and the dissolve started at 30% of the hero —
 * which ate the orb's bottom half and left a dead band of pure black between
 * the light and the wordmark. The screen read as two stacked halves.
 *
 * Now the geometry is anchored the other way round: the caller says where its
 * panel starts, and the orb's lower edge is placed a fixed distance above it.
 * The orb is cropped from the TOP to make that happen, which is graceful (the
 * upper glow is a soft falloff) where cropping the bottom is not (a hard cut
 * through the bright lower rim). Consequence: the gap between the light and
 * the first line of type is a constant on every device, and both auth screens
 * share one composition instead of resembling each other by coincidence.
 */

/**
 * Terminal stop of the dissolve.
 *
 * Not read from --background, and deliberately: the three stops above it in
 * that gradient are the SAME colour at 0.30, 0.80 and full alpha, written as
 * rgba literals because expo-linear-gradient takes colour strings and cannot
 * multiply an alpha onto one it is given. Resolving the last of four while the
 * first three stay hardcoded would leave a ramp that half-follows the theme,
 * which is a worse failure than one that does not follow it at all — the
 * dissolve would end on a colour the band above it is not made of, and the seam
 * this whole component exists to remove would come back. All four move together
 * once there is a way to derive the alpha stops, or none of them do.
 */
const CANVAS = "#06070A";

/**
 * Source geometry, measured off the clip rather than guessed: the frame is
 * 720x1280, and sampling row luminance across all 10 seconds puts the orb's
 * light between 0.16 and 0.71 of the frame height. 0.70 is where the lower rim
 * goes black — the edge the composition hangs off.
 */
const SOURCE_ASPECT = 1280 / 720;
const ORB_BOTTOM_IN_SOURCE = 0.7;

/** Screen-height share between the orb's lower edge and the panel's first line. */
const ORB_TO_PANEL_GAP = 0.035;
/** How far past the panel top the dissolve runs before the video box ends. */
const FADE_TAIL = 0.03;

export type AuthHeroVariant = "signIn" | "signUp";

/**
 * Where each screen's panel begins, as a share of screen height.
 *
 * These are the only two numbers that differ between the screens, and they
 * differ only because sign-up carries a third field plus a native header. Both
 * are chosen so the panel's last line clears the home indicator without
 * scrolling on a 6.1" phone at the default text size.
 */
const PANEL_START: Record<AuthHeroVariant, number> = {
  signIn: 0.44,
  signUp: 0.38,
};

/**
 * Where the panel begins, after Dynamic Type has had its say.
 *
 * The hero is decoration and the form is the task, so as text grows the hero
 * is what gives ground. Without this, an AX-sized panel keeps its full-height
 * hero above it and the sign-in button ends up below the fold on a screen that
 * has plenty of room — the user scrolls past an orb to reach the only control.
 * Capped at 2x because past that the hero has already collapsed to a band of
 * light and there is nothing left to reclaim.
 *
 * Both the backdrop and the screen read this, which is what keeps the orb's
 * lower edge a fixed distance above the first line of type at every text size.
 */
export function useAuthPanelStart(variant: AuthHeroVariant): number {
  const { fontScale } = useWindowDimensions();
  return PANEL_START[variant] / Math.min(Math.max(fontScale, 1), 2);
}

export function AuthBackdrop({ variant }: { variant: AuthHeroVariant }) {
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const isFocused = useIsFocused();

  const panelStart = useAuthPanelStart(variant);
  // Rendered at its natural aspect and positioned by hand. contentFit="cover"
  // on a box of a different shape would re-introduce a centre crop we do not
  // control, which is the whole problem being fixed here.
  const videoHeight = width * SOURCE_ASPECT;
  const heroHeight = height * (panelStart + FADE_TAIL);
  const crop = Math.max(
    0,
    ORB_BOTTOM_IN_SOURCE * videoHeight - height * (panelStart - ORB_TO_PANEL_GAP),
  );

  // Metro resolves static assets through require(): it is how the bundler
  // discovers the file and rewrites it to an asset reference at build time. An
  // ESM import of an .mp4 is not equivalent — no type declaration exists for it
  // here and it would bypass the asset pipeline. The rule targets CommonJS
  // module imports, which this is not.
  //
  // The directive has to sit immediately above the code. Written above this
  // explanation instead, "next line" resolved to a comment and the suppression
  // silently did nothing.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const player = useVideoPlayer(require("../../assets/video/auth-orb.mp4"), (p) => {
    p.loop = true;
    p.muted = true;
    // Never take the audio session from playback elsewhere on the device.
    p.audioMixingMode = "mixWithOthers";
  });

  useEffect(() => {
    // Both auth screens stay mounted once sign-up is pushed, so without the
    // focus check two H.264 decoders run for one visible screen.
    const shouldPlay = () => !reduceMotion && isFocused;

    if (!shouldPlay()) {
      // Looping ambient video is exactly what Reduce Motion exists to stop.
      // Hold a frame rather than removing the visual entirely.
      player.pause();
      return;
    }
    player.play();

    /**
     * Resume after the app comes back from the background.
     *
     * iOS suspends the AVPlayer when the app leaves the foreground, and nothing
     * restarts it on return: this effect's dependencies are the player, the
     * Reduce Motion setting and screen focus, none of which change across a
     * background/foreground cycle. So the effect never re-ran, `play()` was
     * never called again, and the backdrop sat frozen on its last frame —
     * reachable by swiping up and reopening, which is an entirely ordinary
     * thing to do while typing a password from a password manager.
     *
     * Re-checking `shouldPlay()` inside the handler rather than trusting the
     * closure: Reduce Motion can be toggled in Settings while the app is
     * backgrounded, and coming back from THAT should honour the new preference,
     * not the one that was true when the listener was attached.
     */
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active" && shouldPlay()) player.play();
    });

    return () => sub.remove();
  }, [player, reduceMotion, isFocused]);

  return (
    <View
      style={{ position: "absolute", top: 0, left: 0, right: 0, height: heroHeight }}
      pointerEvents="none"
    >
      <View style={{ flex: 1, overflow: "hidden" }}>
        <Animated.View
          entering={FadeIn.duration(600)}
          style={{ position: "absolute", top: -crop, left: 0, width, height: videoHeight }}
        >
          <VideoView
            style={{ width, height: videoHeight }}
            player={player}
            contentFit="cover"
            nativeControls={false}
            // Decorative; the form carries all the accessible content.
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        </Animated.View>

        {/* Status bar and, on sign-up, the back chevron sit over the orb's upper
            body. Both are system chrome we cannot restyle per-pixel, so they get
            a scrim instead. Short and weak — enough for 4.5:1 on the clock,
            not enough to read as a bar across the top. */}
        <LinearGradient
          colors={["rgba(6,7,10,0.75)", "rgba(6,7,10,0.35)", "transparent"]}
          locations={[0, 0.55, 1]}
          style={{ position: "absolute", top: 0, left: 0, right: 0, height: height * 0.14 }}
        />

        {/* The dissolve. It has to cover the full height of the box, not a band
            at the bottom, or the ramp is steep enough to see as an edge. It
            stays transparent through the orb's bright body and only starts
            closing under its lower rim. */}
        <LinearGradient
          colors={["transparent", "rgba(6,7,10,0.30)", "rgba(6,7,10,0.80)", CANVAS]}
          locations={[0.62, 0.84, 0.95, 1]}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
      </View>
    </View>
  );
}
