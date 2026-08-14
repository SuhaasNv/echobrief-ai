import ActivityKit
import SwiftUI
import WidgetKit

// MARK: - Shared vocabulary

/**
 * Every tap surface in this extension lands on one of these.
 *
 * Triple slash on purpose: `echobrief://(app)/record` would parse `(app)` as the
 * URL's host and leave `record` as the whole path, which Expo Router then has to
 * guess at. With an empty host the entire `/(app)/record` survives as the path
 * and routes exactly like an in-app `router.push`.
 *
 * `internal`, not `private`, because PuffinHomeWidgets.swift links the same
 * routes. One list, so a renamed route breaks in one place.
 */
enum AppLink {
  static let record = url("/(app)/record")
  static let meetings = url("/(app)/meetings")
  static let ask = url("/(app)/ask")
  static let actions = url("/(app)/actions")

  /// Non-optional so `Link(destination:)` can take it without unwrapping. The
  /// fallback is inert rather than correct on purpose — a widget extension that
  /// traps on a bad literal takes the Lock Screen surface down with it, and a
  /// link that does nothing is a smaller failure than a crash in a system
  /// process.
  private static func url(_ path: String) -> URL {
    URL(string: "echobrief://" + path) ?? URL(fileURLWithPath: "/")
  }
}

/// The island renders on black in every appearance, so these are the app's dark
/// palette values verbatim rather than dynamic colours. There is no light mode
/// to accommodate here and an asset catalog would only add a build step.
///
/// `internal` for the same reason as `AppLink`: the Home Screen widgets are the
/// same brand and must not drift into a second set of reds.
enum Palette {
  /// --danger, dark. The colour the record screen already uses for "live".
  static let live = Color(red: 1.0, green: 0.373, blue: 0.384)
  /// Deliberately desaturated. Paused has to read as "not recording" at a
  /// glance, from the corner of the eye, without reading a word.
  static let paused = Color(red: 0.62, green: 0.64, blue: 0.67)
  static let label = Color.white
  static let secondary = Color.white.opacity(0.62)
  /// --background and --surface, dark. Only the Home Screen widgets need these;
  /// the island supplies its own black.
  static let canvas = Color(red: 0.024, green: 0.027, blue: 0.039)
  static let surface = Color(red: 0.047, green: 0.051, blue: 0.071)
  /// --tint, dark. Secondary navigation only — never the recording state.
  static let tint = Color(red: 0.298, green: 0.600, blue: 0.973)
}

// MARK: - Motion

/**
 * WHAT ACTUALLY MOVES IN HERE, AND WHY IT IS SO LITTLE.
 *
 * This hierarchy renders inside a system process on a hard budget, and Apple is
 * explicit about it in "Displaying live data with Live Activities":
 *
 *     "the system ignores any animation modifiers — for example,
 *      withAnimation(_:_:) and animation(_:value:) — and uses the system's
 *      animation timing instead."
 *
 * So there are no `.animation(_:value:)` or `withAnimation` calls anywhere below.
 * A modifier that reads as intent and does nothing is how the next person loses
 * an afternoon, so the file spends its motion budget on exactly two things:
 *
 *  1. `Text(timerInterval:)`. GUARANTEED. The system re-renders it every second
 *     with no update from us and no budget spent. This is the only thing in the
 *     island that is certain to move, so it carries "this is live" on its own.
 *
 *  2. The waveform's `.symbolEffect`. LIKELY, NOT GUARANTEED. A repeating
 *     `.symbolEffect` is not documented either way and behaviour has moved across
 *     iOS releases, but when it runs it is the single best "live audio" signal the
 *     API can produce. Nothing here depends on it: the red waveform reads as
 *     recording while perfectly still, and every colour and glyph choice below
 *     stands up in a frozen frame.
 *
 * A hand-rolled `repeatForever` would simply not play, and pushing a new
 * ContentState per frame spends the activity's update budget and gets the app
 * throttled. Those are not options, they are the reason for the two above.
 *
 * The effect is gated at iOS 17. On 16.4–16.7 the symbol renders still, and the
 * red glyph plus the ticking clock still say "live".
 */

/**
 * Lights the waveform's variable layers in sequence — the animated recording
 * signal, applied wherever the live glyph appears.
 *
 * `waveform` and `waveform.slash` are both in SF Symbols' `variable` category, so
 * each bar is a separately addressable layer and this effect has something to
 * travel across. `.iterative` (not `.cumulative`): cumulative fills the bars up
 * and holds them, which reads as a progress bar approaching an end; a recording
 * has no end, so a single highlight travelling across is the truer statement.
 *
 * The API member is `dimInactiveLayers` (the spec's shorthand "dimInactive") —
 * chosen over `hideInactiveLayers` so the silhouette stays a recognisable
 * waveform in every frame instead of flickering down to nothing between passes.
 *
 * `.contentTransition(.symbolEffect(.replace))` swaps `waveform` ⇄
 * `waveform.slash` as one decisive change on pause rather than a dissolve through
 * an ambiguous middle frame.
 */
private struct WaveformMotion: ViewModifier {
  let isActive: Bool

  func body(content: Content) -> some View {
    if #available(iOS 17.0, *) {
      content
        .contentTransition(.symbolEffect(.replace))
        .symbolEffect(
          .variableColor.iterative.dimInactiveLayers,
          options: .repeating,
          isActive: isActive
        )
    } else {
      content
    }
  }
}

// MARK: - Pieces

/**
 * The live audio mark, and the identity of this whole activity.
 *
 * Everywhere the recording state is shown it is THIS glyph — a red animated
 * waveform when live, a static grey `waveform.slash` when paused — never a chip,
 * never a red dot. A dot is what the timer, the call and the screen recorder all
 * draw; the waveform is the one mark that says *audio* before it says anything
 * else, and red says *recording*. The pair carries the state standing still, so
 * the `.symbolEffect` on top is a bonus rather than a dependency.
 *
 * Scaled with `font(size:)` rather than `.resizable()` on purpose: a resizable SF
 * Symbol is no longer treated as a symbol and `symbolEffect` stops applying.
 */
private struct AudioIndicator: View {
  let isPaused: Bool
  let size: CGFloat
  var weight: Font.Weight = .regular

  var body: some View {
    Image(systemName: isPaused ? "waveform.slash" : "waveform")
      .font(.system(size: size, weight: weight))
      .foregroundStyle(isPaused ? Palette.paused : Palette.live)
      .modifier(WaveformMotion(isActive: !isPaused))
  }
}

/// Elapsed time, ticked by the system rather than by us.
///
/// WHITE while live, grey while paused — deliberately never red. Live reads as a
/// single red element (the waveform) beside a white clock; paused drops the whole
/// pair to grey. Two reds would blur which one is the state.
///
/// The range's upper bound is a 24 hour ceiling, not a duration: `timerInterval`
/// only clamps the display, and nothing renders differently until it is reached.
/// A meeting cannot get near it, and the activity's own stale date fires first.
private struct ElapsedTime: View {
  let state: RecordingActivityAttributes.ContentState
  let size: CGFloat
  let weight: Font.Weight

  var body: some View {
    Text(
      timerInterval: state.startedAt...state.startedAt.addingTimeInterval(24 * 60 * 60),
      pauseTime: state.pausedAt,
      countsDown: false,
      // TRUE EVERYWHERE, DELIBERATELY. This renders `0:00:07` from the first
      // second rather than `00:07`. Apple documents the flag as "whether the
      // hours component is shown", not "shown once needed", and an hour-long
      // meeting reading `05:12` is a wrong number on the one surface that exists
      // to report a number.
      showsHours: true
    )
    // Monospaced digits are not a nicety here. This reflows every second inside a
    // fixed-width region, and proportional figures make the whole pill twitch on
    // every tick.
    .font(.system(size: size, weight: weight, design: .rounded).monospacedDigit())
    .foregroundStyle(state.isPaused ? Palette.paused : Palette.label)
    // Insurance, not layout. The compact region is the narrowest surface in the
    // OS and the string grows a character at the one hour mark; scaling by a
    // sixth is invisible, being truncated to `1:23:4…` is not.
    .lineLimit(1)
    .minimumScaleFactor(0.85)
  }
}

/// One capsule control. `tint` colours the icon+label; the fill is the same
/// colour at a low opacity, so a button carries its own meaning without a second
/// hue. `fill` and `height` differ per surface (Pause 10% vs End 15%; ~30pt in
/// the island, ~34pt on the Lock Screen), so both are parameters rather than
/// baked in.
private struct ControlLabel: View {
  let systemImage: String
  let title: String
  let tint: Color
  let fill: Double
  let height: CGFloat

  var body: some View {
    HStack(spacing: 5) {
      Image(systemName: systemImage).font(.system(size: 12, weight: .bold))
      Text(title).font(.system(size: 14, weight: .semibold))
    }
    .foregroundStyle(tint)
    // maxWidth splits the row 50/50; the fixed height keeps the two capsules the
    // same size regardless of label length.
    .frame(maxWidth: .infinity)
    .frame(height: height)
    .background(tint.opacity(fill), in: Capsule())
    .contentShape(Capsule())
  }
}

/**
 * Pause/Resume and End, side by side.
 *
 * On iOS 17+ these are real `Button(intent:)` controls that act in place — see
 * RecordingIntents.swift for why they reach the recorder without an App Group.
 * On 16.4–16.7 `Button(intent:)` does not exist, so rather than draw two buttons
 * that quietly do nothing, the row collapses to one honest link that opens the
 * app. A dead control is worse than an absent one.
 *
 * Pause = white content on white/10%. End = `Palette.live` content on live/15%,
 * so End reads as the one destructive action without shouting.
 */
private struct ControlRow: View {
  let isPaused: Bool
  let height: CGFloat

  var body: some View {
    if #available(iOS 17.0, *) {
      HStack(spacing: 8) {
        if isPaused {
          Button(intent: ResumeRecordingIntent()) {
            ControlLabel(systemImage: "record.circle", title: "Resume", tint: Palette.label, fill: 0.10, height: height)
          }
          .buttonStyle(.plain)
        } else {
          Button(intent: PauseRecordingIntent()) {
            ControlLabel(systemImage: "pause.fill", title: "Pause", tint: Palette.label, fill: 0.10, height: height)
          }
          .buttonStyle(.plain)
        }

        Button(intent: EndRecordingIntent()) {
          ControlLabel(systemImage: "stop.fill", title: "End", tint: Palette.live, fill: 0.15, height: height)
        }
        .buttonStyle(.plain)
      }
    } else {
      Link(destination: AppLink.record) {
        ControlLabel(systemImage: "arrow.up.forward", title: "Open Puffin", tint: Palette.label, fill: 0.10, height: height)
      }
    }
  }
}

// MARK: - Lock Screen / banner

/**
 * Shown on the Lock Screen and as the banner on devices with no island, which is
 * every iPhone below the 14 Pro.
 *
 * TWO TIGHT ROWS, not the old four-zone tower. Row one answers all three
 * questions a recording card exists to answer, left to right in the order they
 * are asked: *is it recording* (the red waveform), *of what* (the title, taking
 * the flexible middle), *for how long* (the clock, pinned trailing). Row two is
 * the only two things you can do, split evenly. Nothing floats and there is no
 * inner card — the activity background is the card.
 */
private struct RecordingLockScreenView: View {
  let context: ActivityViewContext<RecordingActivityAttributes>

  var body: some View {
    VStack(spacing: 8) {
      HStack(spacing: 10) {
        // The recording signal: red animated waveform live, grey slash paused.
        AudioIndicator(isPaused: context.state.isPaused, size: 20, weight: .medium)

        // Named recording or a quiet fallback. The recorder pre-fills the title
        // with a timestamp; the JS side sends an empty string rather than that
        // placeholder, so an empty title genuinely means "unnamed". Takes the
        // flexible middle and is the one thing allowed to truncate, which is what
        // keeps a long title from shoving the clock off the card.
        Group {
          if !context.attributes.title.isEmpty {
            Text(context.attributes.title).foregroundStyle(Palette.label)
          } else {
            Text("Recording").foregroundStyle(Palette.secondary)
          }
        }
        .font(.system(size: 16, weight: .medium))
        .lineLimit(1)
        .frame(maxWidth: .infinity, alignment: .leading)

        // The reported number, pinned to the trailing edge.
        ElapsedTime(state: context.state, size: 17, weight: .semibold)
      }

      ControlRow(isPaused: context.state.isPaused, height: 34)
    }
    // Tighter than before, and no inner box — the padding sits straight on the
    // activity background tint.
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
  }
}

// MARK: - Widget

struct RecordingLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: RecordingActivityAttributes.self) { context in
      RecordingLockScreenView(context: context)
        // 0.92 of the app's own canvas. This tint composites over whatever
        // wallpaper the user has; near-opaque keeps 0.62-opacity secondary text
        // and the desaturated paused grey above AA, and makes the card
        // recognisably Puffin's surface rather than a grey rectangle.
        .activityBackgroundTint(Palette.canvas.opacity(0.92))
        .activitySystemActionForegroundColor(Palette.label)
        .widgetURL(AppLink.record)
    } dynamicIsland: { context in
      let paused = context.state.isPaused

      return DynamicIsland {
        /*
         * EXPANDED, ON LONG PRESS.
         *
         * The leading and trailing regions are the slivers either side of the
         * camera housing, not halves of the screen, so they carry one object
         * each: waveform left, clock right — the compact pill, grown. Every word
         * lives in `.bottom`, the only full-width region. There is no "RECORDING"
         * status chip anymore; the red waveform already is the status.
         */
        DynamicIslandExpandedRegion(.leading) {
          AudioIndicator(isPaused: paused, size: 22, weight: .medium)
            .padding(.leading, 4)
        }

        DynamicIslandExpandedRegion(.trailing) {
          ElapsedTime(state: context.state, size: 20, weight: .semibold)
            .padding(.trailing, 4)
        }

        DynamicIslandExpandedRegion(.bottom) {
          // Two tight lines: what is being recorded, then what you can do about
          // it. ~78pt all in — one row shorter than the old chip-plus-title-plus-
          // controls stack.
          VStack(alignment: .leading, spacing: 8) {
            if !context.attributes.title.isEmpty {
              Text(context.attributes.title)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Palette.label)
                .lineLimit(1)
            } else {
              // Quiet fallback — the waveform and clock are already saying the
              // loud part.
              Text("Recording")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Palette.secondary)
                .lineLimit(1)
            }

            ControlRow(isPaused: paused, height: 30)
          }
        }
      } compactLeading: {
        /*
         * THE SURFACE THAT MATTERS. Visible whenever the phone is unlocked and the
         * recording is running — call it 99% of the activity's life. A bare red
         * waveform, no capsule (a tinted pill inside the island's own pill reads
         * as two fragments, not one control). The frame + leading padding keep it
         * balanced against the numerals opposite the housing.
         */
        AudioIndicator(isPaused: paused, size: 16, weight: .semibold)
          .frame(width: 20)
          .padding(.leading, 2)
      } compactTrailing: {
        // The clock — white while live, grey while paused, never red, so exactly
        // one red element (the waveform) is on screen at a time. Already
        // monospaced, so weight costs no width jitter as it ticks. This is the
        // only guaranteed motion, alive even when the waveform is standing still.
        ElapsedTime(state: context.state, size: 15, weight: .medium)
          .frame(minWidth: 44, alignment: .trailing)
      } minimal: {
        /*
         * Shown when another activity holds the island and we are reduced to a
         * single circle. The bare `waveform` (not the enclosed circle variant)
         * keeps the identity mark consistent with every other surface; it is in
         * the `variable` category, so the bars still animate while live.
         */
        AudioIndicator(isPaused: paused, size: 15, weight: .medium)
      }
      // Tints the hairline around the expanded island red while live, grey while
      // paused, so the state is legible even in peripheral vision.
      .keylineTint(paused ? Palette.paused : Palette.live)
      .widgetURL(AppLink.record)
    }
  }
}
