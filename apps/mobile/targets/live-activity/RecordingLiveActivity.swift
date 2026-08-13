import ActivityKit
import SwiftUI
import WidgetKit

// MARK: - Shared vocabulary

/// Every tap surface lands here.
///
/// Triple slash on purpose: `echobrief://(app)/record` would parse `(app)` as
/// the URL's host and leave `record` as the whole path, which Expo Router then
/// has to guess at. With an empty host the entire `/(app)/record` survives as
/// the path and routes exactly like an in-app `router.push`.
private let recordScreenURL = URL(string: "echobrief:///(app)/record")

/// The island renders on black in every appearance, so these are the app's dark
/// palette values verbatim rather than dynamic colours. There is no light mode
/// to accommodate here and an asset catalog would only add a build step.
private enum Palette {
  /// --danger, dark. The colour the record screen already uses for "live".
  static let live = Color(red: 1.0, green: 0.373, blue: 0.384)
  /// Deliberately desaturated. Paused has to read as "not recording" at a
  /// glance, from the corner of the eye, without reading a word.
  static let paused = Color(red: 0.62, green: 0.64, blue: 0.67)
  static let label = Color.white
  static let secondary = Color.white.opacity(0.62)
}

// MARK: - Motion

/**
 * All continuous motion in this file is SF Symbol effects, and that is a
 * platform constraint rather than a preference.
 *
 * This view hierarchy renders inside a system process on a hard budget.
 * WidgetKit does not run `repeatForever` animations — a hand-rolled pulse would
 * simply not play — and the only other way to move a pixel is to push a new
 * ContentState, which spends the activity's update budget and gets the app
 * throttled. Symbol effects and `Text(timerInterval:)` are the two things the
 * system animates on our behalf for free, so they carry the whole design.
 *
 * Both effects are gated at iOS 17. On 16.4–16.7 the symbols still render, just
 * still — the glyph, the colour and the ticking clock still say "live", so the
 * fallback degrades rather than breaks.
 */
private struct PulsingSymbol: ViewModifier {
  let isActive: Bool

  func body(content: Content) -> some View {
    if #available(iOS 17.0, *) {
      content
        // Swaps glyphs rather than cross-fading two views, so pause reads as one
        // decisive change instead of a dissolve into an ambiguous middle frame.
        .contentTransition(.symbolEffect(.replace))
        // The system picks the period. A hand-tuned one would look wrong next
        // to every other pulsing indicator in the OS, and this is a surface
        // where matching the platform matters more than having an opinion.
        .symbolEffect(.pulse, options: .repeating, isActive: isActive)
    } else {
      content
    }
  }
}

private struct VaryingSymbol: ViewModifier {
  let isActive: Bool

  func body(content: Content) -> some View {
    if #available(iOS 17.0, *) {
      content
        .contentTransition(.symbolEffect(.replace))
        // Lights the waveform's bars in sequence — reads as sound arriving,
        // which is exactly what it is standing in for. `dimInactiveLayers`
        // keeps the glyph's silhouette intact between passes so it never
        // flickers down to nothing.
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

/// The live indicator: a pulsing record ring, a still pause glyph when stopped.
private struct RecordIndicator: View {
  let isPaused: Bool
  let size: CGFloat

  var body: some View {
    Image(systemName: isPaused ? "pause.circle.fill" : "record.circle")
      .font(.system(size: size, weight: .medium))
      .foregroundStyle(isPaused ? Palette.paused : Palette.live)
      .modifier(PulsingSymbol(isActive: !isPaused))
      .animation(.easeInOut(duration: 0.25), value: isPaused)
  }
}

/// The live audio indicator.
private struct AudioIndicator: View {
  let isPaused: Bool
  let size: CGFloat

  var body: some View {
    Image(systemName: isPaused ? "waveform.slash" : "waveform")
      .font(.system(size: size, weight: .regular))
      .foregroundStyle(isPaused ? Palette.paused.opacity(0.7) : Palette.live)
      .modifier(VaryingSymbol(isActive: !isPaused))
      .animation(.easeInOut(duration: 0.25), value: isPaused)
  }
}

/// Elapsed time, ticked by the system rather than by us.
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
      showsHours: true
    )
    // Monospaced digits are not a nicety here. This reflows every second inside
    // a fixed-width island region, and proportional figures make the whole pill
    // twitch on every tick.
    .font(.system(size: size, weight: weight, design: .rounded).monospacedDigit())
    .foregroundStyle(state.isPaused ? Palette.paused : Palette.label)
    .animation(.easeInOut(duration: 0.25), value: state.isPaused)
  }
}

private struct StatusLabel: View {
  let isPaused: Bool

  var body: some View {
    Text(isPaused ? "PAUSED" : "RECORDING")
      .font(.system(size: 10, weight: .semibold))
      .kerning(0.7)
      .foregroundStyle(isPaused ? Palette.paused : Palette.live)
      .animation(.easeInOut(duration: 0.25), value: isPaused)
  }
}

private struct ControlLabel: View {
  let systemImage: String
  let title: String
  let tint: Color

  var body: some View {
    HStack(spacing: 5) {
      Image(systemName: systemImage).font(.system(size: 12, weight: .bold))
      Text(title).font(.system(size: 14, weight: .semibold))
    }
    .foregroundStyle(tint)
    .frame(maxWidth: .infinity)
    .frame(height: 36)
    .background(tint.opacity(0.16), in: Capsule())
  }
}

/**
 * Pause/Resume and End.
 *
 * On iOS 17+ these are real `Button(intent:)` controls that act in place — see
 * RecordingIntents.swift for why they reach the recorder without an App
 * Group. On 16.4–16.7 `Button(intent:)` does not exist, so rather than draw two
 * buttons that quietly do nothing, the row collapses to one honest link that
 * opens the app. A dead control is worse than an absent one.
 */
private struct ControlRow: View {
  let isPaused: Bool

  var body: some View {
    if #available(iOS 17.0, *) {
      HStack(spacing: 8) {
        if isPaused {
          Button(intent: ResumeRecordingIntent()) {
            ControlLabel(systemImage: "record.circle", title: "Resume", tint: Palette.label)
          }
          .buttonStyle(.plain)
        } else {
          Button(intent: PauseRecordingIntent()) {
            ControlLabel(systemImage: "pause.fill", title: "Pause", tint: Palette.label)
          }
          .buttonStyle(.plain)
        }

        Button(intent: EndRecordingIntent()) {
          ControlLabel(systemImage: "stop.fill", title: "End", tint: Palette.live)
        }
        .buttonStyle(.plain)
      }
    } else if let recordScreenURL {
      Link(destination: recordScreenURL) {
        ControlLabel(systemImage: "arrow.up.forward", title: "Open EchoBrief", tint: Palette.label)
      }
    }
  }
}

// MARK: - Lock Screen / banner

/// Shown on the Lock Screen and as the banner on devices with no island, which
/// is every iPhone below the 14 Pro. Wider and calmer than the island: there is
/// room for the title on its own line and no reason to abbreviate.
private struct RecordingLockScreenView: View {
  let context: ActivityViewContext<RecordingActivityAttributes>

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 8) {
        RecordIndicator(isPaused: context.state.isPaused, size: 16)
        StatusLabel(isPaused: context.state.isPaused)
        Spacer(minLength: 8)
        ElapsedTime(state: context.state, size: 20, weight: .semibold)
      }

      HStack(spacing: 10) {
        Text(context.attributes.title)
          .font(.system(size: 15, weight: .medium))
          .foregroundStyle(Palette.secondary)
          .lineLimit(1)
        Spacer(minLength: 8)
        AudioIndicator(isPaused: context.state.isPaused, size: 17)
      }

      ControlRow(isPaused: context.state.isPaused)
    }
    .padding(16)
  }
}

// MARK: - Widget

struct RecordingLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: RecordingActivityAttributes.self) { context in
      RecordingLockScreenView(context: context)
        .activityBackgroundTint(Color.black.opacity(0.55))
        .activitySystemActionForegroundColor(Palette.label)
        .widgetURL(recordScreenURL)
    } dynamicIsland: { context in
      let paused = context.state.isPaused

      return DynamicIsland {
        // Expanded, on long press. Deliberately not a scaled-up compact view:
        // the compact pill answers "is it still going and for how long", while
        // this answers "what am I recording and what can I do about it". It
        // gains the meeting title, a real audio indicator and the controls, and
        // the two halves of the compact pill become the header row.
        DynamicIslandExpandedRegion(.leading) {
          HStack(spacing: 6) {
            RecordIndicator(isPaused: paused, size: 15)
            StatusLabel(isPaused: paused)
          }
          .padding(.leading, 4)
        }

        DynamicIslandExpandedRegion(.trailing) {
          ElapsedTime(state: context.state, size: 17, weight: .semibold)
            .padding(.trailing, 4)
        }

        DynamicIslandExpandedRegion(.bottom) {
          VStack(spacing: 10) {
            HStack(spacing: 10) {
              Text(context.attributes.title)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Palette.secondary)
                .lineLimit(1)
              Spacer(minLength: 8)
              AudioIndicator(isPaused: paused, size: 16)
            }
            ControlRow(isPaused: paused)
          }
          .padding(.top, 2)
        }
      } compactLeading: {
        RecordIndicator(isPaused: paused, size: 15)
      } compactTrailing: {
        ElapsedTime(state: context.state, size: 13, weight: .medium)
      } minimal: {
        // Shown when another activity has the island and we are reduced to a
        // single circle. Only the indicator survives — the clock is unreadable
        // at this size, and a truncated clock is worse than none.
        RecordIndicator(isPaused: paused, size: 14)
      }
      // Tints the hairline around the expanded island, so the live/paused state
      // is legible even in peripheral vision.
      .keylineTint(paused ? Palette.paused : Palette.live)
      .widgetURL(recordScreenURL)
    }
  }
}
