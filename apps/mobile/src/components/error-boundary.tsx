import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { haptics } from "@/lib/haptics";

/**
 * The last line of defence against a white screen.
 *
 * React Native ships no error boundary of its own, and a hook cannot catch a
 * render throw, so this is a class component. Without one, a single bad field
 * in a cached API response unmounts the entire tree in a release build and the
 * user is left staring at the canvas colour with no way back short of force
 * quitting the app.
 *
 * Two properties matter more than the visuals:
 *
 *   The retry has to be a real retry. Clearing the error and re-rendering the
 *   same children with the same state would usually throw again on the same
 *   frame, so the children are remounted behind a changing key, and the host
 *   gets an `onReset` hook to change something real first — the root and tab
 *   boundaries drop the query cache on a repeat failure, which is the one thing
 *   that actually fixes the common cause.
 *
 *   A second failure must not look like the first. `attempts` counts CONSECUTIVE
 *   failures, so the fallback can escalate its copy and its action instead of
 *   offering the same dead button forever.
 */

export interface ErrorBoundaryFallbackProps {
  error: Error;
  /** 1 on the first catch, 2 when the retry threw again, and so on. */
  attempts: number;
  reset: () => void;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: (props: ErrorBoundaryFallbackProps) => ReactNode;
  /**
   * Runs before the children remount, with the failure count being recovered
   * from. This is where to drop cached data on a repeat failure.
   */
  onReset?: (attempts: number) => void;
  /**
   * Any change clears a caught error. Pass the current route so navigating
   * somewhere else recovers on its own rather than stranding the user.
   */
  resetKey?: string | number;
}

interface ErrorBoundaryState {
  error: Error | null;
  attempts: number;
  /** Bumped on every reset so the children remount instead of re-rendering. */
  generation: number;
}

/**
 * A throw landing this soon after a retry is the same failure repeating, not a
 * new one. Longer than a couple of frames so a slow first paint still counts,
 * short enough that an unrelated crash ten minutes later starts over at one.
 */
const REPEAT_WINDOW_MS = 5000;

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, attempts: 0, generation: 0 };

  /** Timestamp of the last reset, for telling a repeat failure from a fresh one. */
  private resetAt = 0;

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const repeat = this.resetAt > 0 && Date.now() - this.resetAt < REPEAT_WINDOW_MS;
    this.setState((state) => ({ attempts: repeat ? state.attempts + 1 : 1 }));

    if (__DEV__) {
      // Release builds have no console worth writing to, and the fallback puts
      // the message on screen where it can be read and reported.
      console.error("Render error caught by boundary:", error, info.componentStack);
    }
  }

  componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (previous.resetKey !== this.props.resetKey && this.state.error !== null) {
      this.clear();
    }
  }

  private clear = (): void => {
    this.setState((state) => ({ error: null, generation: state.generation + 1 }));
  };

  private handleReset = (): void => {
    this.resetAt = Date.now();
    this.props.onReset?.(Math.max(1, this.state.attempts));
    this.clear();
  };

  render(): ReactNode {
    const { error, attempts, generation } = this.state;

    if (error !== null) {
      // componentDidCatch lands one render after getDerivedStateFromError, so
      // the count can still be zero on the first fallback frame.
      return this.props.fallback({
        error,
        attempts: Math.max(1, attempts),
        reset: this.handleReset,
      });
    }

    return <Fragment key={generation}>{this.props.children}</Fragment>;
  }
}

/**
 * The fallback itself.
 *
 * Deliberately plain: it has to render correctly in a tree that has already
 * proved it can fail, so there is no animation, no data fetching, and no
 * dependency beyond the safe area insets.
 *
 * The message is shown rather than hidden. It is the only thing the user can
 * pass on to support, and a generic "something went wrong" with the cause
 * swallowed is how a bug survives twenty reports.
 */
export function CrashScreen({
  error,
  attempts,
  reset,
  title = "Puffin could not draw this screen",
  bottomInset = 0,
}: ErrorBoundaryFallbackProps & {
  title?: string;
  /** Tab screens sit behind the tab bar and owe themselves this clearance. */
  bottomInset?: number;
}) {
  const insets = useSafeAreaInsets();
  const repeated = attempts > 1;

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          paddingTop: insets.top + 24,
          paddingBottom: Math.max(insets.bottom, 24) + bottomInset,
          paddingHorizontal: 20,
          gap: 20,
        }}
      >
        <View className="gap-3">
          <Text
            className="font-display text-[24px] leading-[30px] text-label"
            maxFontSizeMultiplier={1.5}
          >
            {title}
          </Text>
          <Text
            className="text-[15px] leading-[21px] text-label-secondary"
            maxFontSizeMultiplier={1.8}
          >
            {repeated
              ? "It failed again. Trying once more drops the data Puffin has cached and loads it fresh from the server. If that does not clear it either, close the app and open it again."
              : "This is a fault in the app, not something you did. Nothing has been sent anywhere, and trying again reloads the screen."}
          </Text>
        </View>

        <View
          className="overflow-hidden rounded-card border border-edge bg-surface p-4"
          style={{ borderCurve: "continuous" }}
        >
          <View className="absolute inset-x-0 top-0 z-10 h-px bg-highlight" pointerEvents="none" />
          <Text
            className="text-[13px] leading-[18px] text-label-tertiary"
            maxFontSizeMultiplier={1.6}
            selectable
          >
            {error.message || error.name || "Unknown error"}
          </Text>
        </View>

        <Pressable
          onPress={() => {
            haptics.tap();
            reset();
          }}
          accessibilityRole="button"
          className="min-h-[52px] items-center justify-center rounded-full bg-label active:opacity-80"
        >
          <Text className="text-[17px] font-semibold text-background" maxFontSizeMultiplier={1.6}>
            {repeated ? "Reload from the server" : "Try again"}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
