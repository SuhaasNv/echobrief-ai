import { View, type ViewProps } from "react-native";

/**
 * Surface primitive.
 *
 * Three things together make a dark card read as an object rather than a flat
 * rectangle, and the previous version had only the first:
 *
 *   1. A lighter fill than the canvas — but at this palette that step is only
 *      ~5 luminance points, which alone is invisible on a real display.
 *   2. A hairline edge at rgba(255,255,255,0.07). Depth in dark UI is carried
 *      by edges; every serious dark system ships a white-alpha border ramp
 *      separate from its surface ramp.
 *   3. A 1px highlight on the TOP EDGE ONLY, which reads as a light source
 *      above and turns the border into a bevel. This is the highest-yield
 *      detail in dark interface work and costs one View.
 *
 * `borderCurve: "continuous"` is the squircle. A plain circular radius is a
 * persistent, if subtle, non-iOS tell.
 */
export interface CardProps extends ViewProps {
  /** Recessed instead of raised — for wells like transcript blocks. */
  inset?: boolean;
  /** Suppress the top highlight where a card sits under another surface. */
  flat?: boolean;
  className?: string;
}

export function Card({
  inset = false,
  flat = false,
  className = "",
  children,
  style,
  ...rest
}: CardProps) {
  return (
    <View
      className={`overflow-hidden rounded-card border border-edge ${
        inset ? "bg-inset" : "bg-surface"
      } ${className}`}
      style={[{ borderCurve: "continuous" }, style]}
      {...rest}
    >
      {!flat && !inset ? (
        <View className="absolute inset-x-0 top-0 h-px bg-highlight" pointerEvents="none" />
      ) : null}
      {children}
    </View>
  );
}
