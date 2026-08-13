import { Text, View } from "react-native";
import Svg, { Path, Polygon } from "react-native-svg";

import { useColorToken } from "@/lib/tokens";

/**
 * Transport glyphs.
 *
 * Drawn rather than pulled from SF Symbols, matching the decision already made
 * in components/meeting/meeting-menu: nothing in this app imports expo-symbols,
 * and installs are frozen.
 *
 * `gobackward.15` and `goforward.30` are the two the system does NOT offer at
 * arbitrary intervals anyway, so the numeral is a real Text node laid over the
 * arc. That also keeps it on the system face, where it inherits Dynamic Type
 * and renders the digits at the right optical size instead of as scaled paths.
 *
 * Strokes take a colour value rather than a class name, because
 * react-native-svg is not styled by className. Each glyph therefore reads
 * --label itself when the caller does not override it; a token read is a hook,
 * so it cannot be a parameter default.
 */

export function PlayGlyph({ size = 30, color }: { size?: number; color?: string }) {
  const label = useColorToken("--label");
  const glyph = color ?? label;

  return (
    <Svg width={size} height={size} viewBox="0 0 30 30">
      {/* Optically centred, not geometrically: a triangle centred on the box
          reads as sitting left of centre inside a round button. */}
      <Polygon points="10.5,6 24,15 10.5,24" fill={glyph} />
    </Svg>
  );
}

export function PauseGlyph({ size = 30, color }: { size?: number; color?: string }) {
  const label = useColorToken("--label");
  const glyph = color ?? label;

  return (
    <Svg width={size} height={size} viewBox="0 0 30 30">
      <Path d="M9.5 6h3.6v18H9.5zM16.9 6h3.6v18h-3.6z" fill={glyph} />
    </Svg>
  );
}

interface SkipGlyphProps {
  seconds: number;
  size?: number;
  color?: string;
}

/**
 * Circular arrow with the interval inside it.
 *
 * The arc leaves a gap in the top quadrant it travels into, so the arrowhead
 * has somewhere to sit; without the gap the head reads as a smudge on a closed
 * ring at 26pt.
 */
function SkipGlyph({ seconds, size = 26, color, back }: SkipGlyphProps & { back: boolean }) {
  const label = useColorToken("--label");
  const glyph = color ?? label;

  return (
    <View style={{ width: size, height: size }} className="items-center justify-center">
      <Svg width={size} height={size} viewBox="0 0 26 26" style={{ position: "absolute" }}>
        <Path
          d={
            // Sweep flags were inverted. With the old pair the endpoint-to-centre
            // solve puts each arc's centre at a corner of the 0 0 26 26 viewBox,
            // so most of the 270 degrees sits at negative coordinates and gets
            // clipped, leaving two stubs that looked like stray punctuation.
            back ? "M13 4.4 A 8.6 8.6 0 1 1 4.4 13" : "M13 4.4 A 8.6 8.6 0 1 0 21.6 13"
          }
          stroke={glyph}
          strokeWidth={1.7}
          strokeLinecap="round"
          fill="none"
        />
        <Polygon
          points={back ? "13.6,1.4 13.6,7.4 9.4,4.4" : "12.4,1.4 12.4,7.4 16.6,4.4"}
          fill={glyph}
        />
      </Svg>
      <Text
        className="text-[9px] font-semibold"
        style={{ color: glyph, fontVariant: ["tabular-nums"], marginTop: 2 }}
        // Locked: the numeral is inside a 26pt ring it cannot grow out of. The
        // control's meaning is carried by its accessibilityLabel, which does
        // scale.
        allowFontScaling={false}
      >
        {seconds}
      </Text>
    </View>
  );
}

export function SkipBackGlyph(props: SkipGlyphProps) {
  return <SkipGlyph {...props} back />;
}

export function SkipForwardGlyph(props: SkipGlyphProps) {
  return <SkipGlyph {...props} back={false} />;
}

/** Downward chevron for the return-to-current affordance. */
export function ChevronDownGlyph({ size = 13, color }: { size?: number; color?: string }) {
  const label = useColorToken("--label");
  const glyph = color ?? label;

  return (
    <Svg width={size} height={size} viewBox="0 0 13 13">
      <Path
        d="M2.6 4.6 6.5 8.6 10.4 4.6"
        stroke={glyph}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
