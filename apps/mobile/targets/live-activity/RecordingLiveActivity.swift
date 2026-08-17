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
 */
enum AppLink {
  static let record = url("/(app)/record")
  static let meetings = url("/(app)/meetings")
  static let ask = url("/(app)/ask")
  static let actions = url("/(app)/actions")

  private static func url(_ path: String) -> URL {
    URL(string: "echobrief://" + path) ?? URL(fileURLWithPath: "/")
  }
}

/// The island renders on black in every appearance, so these are the app's dark
/// palette values verbatim rather than dynamic colours.
enum Palette {
  /// --danger, dark. The colour the record screen already uses for "live".
  static let live = Color(red: 1.0, green: 0.373, blue: 0.384)
  /// Deliberately desaturated. Paused has to read as "not recording" at a glance.
  static let paused = Color(red: 0.62, green: 0.64, blue: 0.67)
  static let label = Color.white
  static let secondary = Color.white.opacity(0.62)
  /// A hairline the divider uses; white knocked well back so it reads as a seam.
  static let separator = Color.white.opacity(0.12)
  /// --background and --surface, dark.
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
 * explicit: "the system ignores any animation modifiers ... and uses the
 * system's animation timing instead." So there are no `.animation` or
 * `withAnimation` calls anywhere below. The file spends its motion budget on two
 * things: `Text(timerInterval:)`, which the system re-renders every second on its
 * own, and the waveform's repeating `.symbolEffect`, which is the single best
 * "live audio" signal the API can produce. Everything reads correctly frozen.
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
 * The live audio mark — a red animated waveform when live, a static grey
 * `waveform.slash` when paused. Everywhere the recording state shows, it is THIS
 * glyph: a dot is what the timer, the call and the screen recorder all draw; the
 * waveform is the one mark that says *audio* before it says anything else, and
 * red says *recording*.
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
/// pair to grey.
private struct ElapsedTime: View {
  let state: RecordingActivityAttributes.ContentState
  let size: CGFloat
  let weight: Font.Weight

  var body: some View {
    Text(
      timerInterval: state.startedAt...state.startedAt.addingTimeInterval(24 * 60 * 60),
      pauseTime: state.pausedAt,
      countsDown: false,
      showsHours: true
    )
    .font(.system(size: size, weight: weight, design: .rounded).monospacedDigit())
    .foregroundStyle(state.isPaused ? Palette.paused : Palette.label)
    .lineLimit(1)
    .minimumScaleFactor(0.85)
  }
}

/**
 * The app icon, drawn from the extension's own asset catalog — a widget cannot
 * read the host app's icon, so expo-target.config.js bundles a copy. This is
 * the mark that NAMES the card, the way ember's logo does in Apple's Live
 * Activity examples. Falls back to the same mic-on-white the real icon shows if
 * the asset ever goes missing, so the card never renders an empty square.
 */
private struct AppIconBadge: View {
  let size: CGFloat

  var body: some View {
    // "BrandIcon", never "AppIcon": that name is reserved by the asset-catalog
    // compiler for real app-icon sets, and a colliding imageset loads as a
    // valid-but-empty image — the grey square this badge briefly shipped as.
    if let icon = UIImage(named: "BrandIcon") {
      Image(uiImage: icon)
        .resizable()
        .scaledToFill()
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.24, style: .continuous))
    } else {
      ZStack {
        RoundedRectangle(cornerRadius: size * 0.24, style: .continuous).fill(Color.white)
        Image(systemName: "mic.fill")
          .font(.system(size: size * 0.5, weight: .semibold))
          .foregroundStyle(Color.black)
      }
      .frame(width: size, height: size)
    }
  }
}

/**
 * One wide, labelled capsule — THE control on both surfaces.
 *
 * The round discs this replaced were 34pt and pinned to the trailing edge: in
 * the island's bottom region, which is screen-wide and only ~40pt tall, that
 * read as a speck against a black slab and sat exactly where the expanded
 * corner radius eats it; on the Lock Screen card the same pair floated in the
 * left half with an "Open App ›" link opposite. Two equal capsules spend the
 * width instead — bigger targets, named actions, well inside the curve — and
 * one shape on both surfaces means neither can drift from the other.
 *
 * `solid` inverts it for End — the consequential action carries the filled red
 * so it cannot read as Pause's satellite.
 */
private struct CapsuleControl: View {
  let systemImage: String
  let label: String
  let tint: Color
  var solid: Bool = false

  var body: some View {
    HStack(spacing: 6) {
      Image(systemName: systemImage)
        .font(.system(size: 13, weight: .bold))
      Text(label)
        .font(.system(size: 15, weight: .semibold))
        .lineLimit(1)
    }
    .foregroundStyle(solid ? Palette.label : tint)
    // Both capsules take an equal share of the row. Safe here in a way it is not
    // beside a clock: a greedy sibling squeezes `Text(timerInterval:)` until
    // `minimumScaleFactor` engages and the timer renders as dashes.
    .frame(maxWidth: .infinity)
    .frame(height: 36)
    .background(solid ? tint : tint.opacity(0.14), in: Capsule())
    .contentShape(Capsule())
  }
}

/// Pause/Resume and End, as the bottom row of the expanded island and of the
/// Lock Screen card alike.
///
/// On iOS 17+ these are real `Button(intent:)` controls that act in place — see
/// RecordingIntents.swift for why they reach the recorder without an App Group.
/// On 16.4–16.7 `Button(intent:)` does not exist, so the pair collapses to one
/// honest link that opens the app: a dead control is worse than an absent one.
private struct CapsuleControlRow: View {
  let isPaused: Bool

  var body: some View {
    if #available(iOS 17.0, *) {
      HStack(spacing: 10) {
        if isPaused {
          Button(intent: ResumeRecordingIntent()) {
            CapsuleControl(systemImage: "play.fill", label: "Resume", tint: Palette.label)
          }
          .buttonStyle(.plain)
        } else {
          Button(intent: PauseRecordingIntent()) {
            CapsuleControl(systemImage: "pause.fill", label: "Pause", tint: Palette.label)
          }
          .buttonStyle(.plain)
        }

        Button(intent: EndRecordingIntent()) {
          CapsuleControl(systemImage: "stop.fill", label: "End", tint: Palette.live, solid: true)
        }
        .buttonStyle(.plain)
      }
    } else {
      Link(destination: AppLink.record) {
        CapsuleControl(
          systemImage: "arrow.up.forward", label: "Open EchoBrief", tint: Palette.label)
      }
    }
  }
}

// MARK: - Lock Screen / banner

/**
 * Shown on the Lock Screen and as the banner on devices with no island.
 *
 * TWO ROWS, and the same vocabulary as the expanded island so the surfaces
 * cannot drift: identity and title left, the live pair (waveform + clock)
 * right, the two capsules across the bottom.
 *
 * What this replaced was a four-band card — header, then a hero clock opposite
 * a large ringed waveform, then a rule, then round controls opposite an
 * "Open App ›" link — and it read as four loosely-related quadrants with a
 * pocket of dead space in the middle of each. Three things went:
 *
 *  - The ringed mark. A 50pt red ring beside a solid red End button is two
 *    reds arguing about which one is the state.
 *  - "Open App ›". The card already carries `widgetURL`, so the whole surface
 *    opens the app; the link was a control that duplicated its own container.
 *  - The rule. With two rows there is nothing left to separate.
 */
private struct RecordingLockScreenView: View {
  let context: ActivityViewContext<RecordingActivityAttributes>

  var body: some View {
    let paused = context.state.isPaused
    let title = context.attributes.title

    VStack(alignment: .leading, spacing: 14) {
      HStack(spacing: 10) {
        AppIconBadge(size: 26)

        VStack(alignment: .leading, spacing: 2) {
          Text(title.isEmpty ? "EchoBrief" : title)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(Palette.label)
            .lineLimit(1)
          HStack(spacing: 5) {
            AudioIndicator(isPaused: paused, size: 11, weight: .semibold)
            Text(paused ? "Paused" : "Recording")
              .font(.system(size: 12, weight: .medium))
              .foregroundStyle(Palette.secondary)
              .lineLimit(1)
          }
        }

        Spacer(minLength: 12)

        // The hero clock, and the fixed width is what makes the Spacer above
        // safe: a flexible sibling beside an unconstrained `Text(timerInterval:)`
        // squeezes it until `minimumScaleFactor` engages and it renders `1:--`.
        // 112pt clears `1:00:00` at 30pt monospaced.
        ElapsedTime(state: context.state, size: 30, weight: .semibold)
          .multilineTextAlignment(.trailing)
          .frame(width: 112, alignment: .trailing)
      }

      CapsuleControlRow(isPaused: paused)
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 14)
  }
}

// MARK: - Widget

struct RecordingLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: RecordingActivityAttributes.self) { context in
      RecordingLockScreenView(context: context)
        .activityBackgroundTint(Palette.canvas.opacity(0.92))
        .activitySystemActionForegroundColor(Palette.label)
        .widgetURL(AppLink.record)
    } dynamicIsland: { context in
      let paused = context.state.isPaused
      let title = context.attributes.title

      return DynamicIsland {
        /*
         * EXPANDED, ON LONG PRESS. Laid out the way Music's is: what is playing
         * on the left of the camera, the number on the right, the transport
         * across the bottom.
         *
         * `.center` is deliberately absent. It renders as its own band under the
         * camera, and a band carrying one truncated title cost ~30pt of black
         * card for a line that reads better beside the icon. Three regions, two
         * bands, one card.
         */
        /*
         * MEASURED, NOT GUESSED: this region is ~99pt wide on a 402pt screen,
         * because leading and trailing split what the TrueDepth camera leaves.
         * A 24pt badge and 7pt of gap spend 31 of it, so the text column has
         * ~68pt — which is why the waveform that used to sit beside the status
         * word had to go: it pushed "Recording" to "Record…". The waveform now
         * rides with the clock opposite, where there is room, and the pairing
         * mirrors the compact pill exactly.
         */
        DynamicIslandExpandedRegion(.leading) {
          HStack(spacing: 7) {
            AppIconBadge(size: 24)
            VStack(alignment: .leading, spacing: 1) {
              // "EchoBrief" rather than "Recording" when the meeting is unnamed:
              // the line below already says Recording, and the app's own name is
              // what every system activity puts here.
              Text(title.isEmpty ? "EchoBrief" : title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Palette.label)
                .lineLimit(1)
              Text(paused ? "Paused" : "Recording")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(Palette.secondary)
                .lineLimit(1)
            }
          }
          .padding(.leading, 4)
        }

        DynamicIslandExpandedRegion(.trailing) {
          HStack(spacing: 6) {
            AudioIndicator(isPaused: paused, size: 13, weight: .semibold)
            // A HARD width, not a minimum, and the same two alignments as the
            // compact clock — see `compactTrailing` below for both.
            ElapsedTime(state: context.state, size: 19, weight: .semibold)
              .multilineTextAlignment(.trailing)
              .frame(width: 72, alignment: .trailing)
          }
          // Pushes the pair to the region's trailing edge so the clock lands
          // over the End capsule's outer edge instead of stopping ~55pt short
          // of it. Safe beside a timer only because the timer already carries a
          // fixed width above — a flexible frame around a greedy timer is what
          // squeezes it into `1:--`.
          .frame(maxWidth: .infinity, alignment: .trailing)
          .padding(.trailing, 4)
        }

        DynamicIslandExpandedRegion(.bottom) {
          // Inset from both edges: the island's expanded corner radius is large
          // enough to clip anything flush to the bottom corners, which is what
          // ate the trailing control when this row held round discs.
          CapsuleControlRow(isPaused: paused)
            .padding(.horizontal, 4)
            .padding(.top, 8)
        }
      } compactLeading: {
        AudioIndicator(isPaused: paused, size: 15, weight: .semibold)
          .frame(width: 17)
      } compactTrailing: {
        /*
         * A HARD `width`, and this is the whole reason the pill was ~328pt wide
         * on a 402pt screen.
         *
         * `Text(timerInterval:)` re-renders itself every second, so it cannot
         * name an ideal width and instead asks for everything on offer — the
         * same indeterminacy that blanks the card under `.fixedSize()`. The
         * `minWidth: 44` this replaces set a floor and left the greed intact,
         * so the system grew the compact region to its maximum and the island
         * with it.
         *
         * 50pt fits `1:00:00` at 14pt monospaced with room to spare, and
         * `minimumScaleFactor` absorbs the double-digit-hours case rather than
         * letting iOS truncate the clock to `1:--`.
         *
         * `multilineTextAlignment` as well as the frame's own alignment, and
         * both are needed. A greedy timer expands to fill the 50pt box, so the
         * frame's `.trailing` has nothing left to push — the box IS the text —
         * and the string then draws leading-aligned inside it, which is the
         * dead space that sat between the clock and the pill's right edge while
         * the waveform hugged the left. This aligns the glyphs, not the box.
         */
        ElapsedTime(state: context.state, size: 14, weight: .semibold)
          .multilineTextAlignment(.trailing)
          .frame(width: 50, alignment: .trailing)
      } minimal: {
        AudioIndicator(isPaused: paused, size: 15, weight: .medium)
      }
      .keylineTint(paused ? Palette.paused : Palette.live)
      .widgetURL(AppLink.record)
    }
  }
}
