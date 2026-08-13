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
 * So there are no `.animation(_:value:)` calls anywhere below. There used to be,
 * on five views, and they never ran. They are gone rather than kept as
 * decoration, because a modifier that reads as intent and does nothing is how
 * the next person loses an afternoon.
 *
 * That leaves exactly two sources of motion, in order of how much weight the
 * design puts on them:
 *
 *  1. `Text(timerInterval:)`. GUARANTEED. The system re-renders it every second
 *     with no update from us and no budget spent. This is the only thing in the
 *     island that is certain to move, so it — not the waveform — is what carries
 *     "this is live". Everything else is a bonus.
 *
 *  2. SF Symbol effects. LIKELY, NOT GUARANTEED. `.contentTransition(.symbolEffect(.replace))`
 *     is documented as supported ("the system animates content transitions for
 *     images and SF Symbols"). A *repeating* `.symbolEffect` is not documented
 *     either way, and behaviour has moved across iOS releases. It is used below
 *     because when it runs it is the single best "live audio" signal the API can
 *     produce — but nothing here depends on it. Every glyph is chosen to read
 *     correctly while perfectly still.
 *
 * A hand-rolled `repeatForever` would simply not play, and pushing a new
 * ContentState per frame spends the activity's update budget and gets the app
 * throttled. Those are not options, they are the reason for the two above.
 *
 * Both effects are gated at iOS 17. On 16.4–16.7 the symbols render still, and
 * the glyph, the colour and the ticking clock still say "live".
 */

/// Fades the whole glyph in and out. For symbols with no variable layers.
private struct PulsingSymbol: ViewModifier {
  let isActive: Bool

  func body(content: Content) -> some View {
    if #available(iOS 17.0, *) {
      content
        // Swaps glyphs rather than cross-fading two views, so pause reads as one
        // decisive change instead of a dissolve into an ambiguous middle frame.
        .contentTransition(.symbolEffect(.replace))
        .symbolEffect(.pulse, options: .repeating, isActive: isActive)
    } else {
      content
    }
  }
}

/**
 * Lights a symbol's variable layers in sequence.
 *
 * `waveform`, `waveform.slash` and `waveform.circle.fill` are all in SF Symbols'
 * `variable` category, so each one's bars are separately addressable layers and
 * this effect has something to travel across. (Checked against CoreGlyphs'
 * symbol_categories.plist, not assumed — a symbol with no variable layers
 * silently renders a still glyph.)
 *
 * `.iterative` and not `.cumulative`: cumulative fills the bars up and holds
 * them, which reads as a progress bar approaching an end. A recording has no
 * end. A single highlight travelling across reads as ongoing, which is the true
 * statement.
 *
 * `.reversing` so the highlight walks back rather than snapping to the start.
 * The snap is a hard visual reset once per cycle and it is the thing that made
 * this read as a loading indicator; bouncing reads as oscillation, which is what
 * sound does.
 *
 * `.dimInactiveLayers` and not `.hideInactiveLayers`: the silhouette stays whole
 * between passes, so the glyph never flickers down to nothing and is still a
 * recognisable waveform in every frame.
 */
private struct VaryingSymbol: ViewModifier {
  let isActive: Bool

  func body(content: Content) -> some View {
    if #available(iOS 17.0, *) {
      content
        .contentTransition(.symbolEffect(.replace))
        .symbolEffect(
          .variableColor.iterative.reversing.dimInactiveLayers,
          options: .repeating,
          isActive: isActive
        )
    } else {
      content
    }
  }
}

// MARK: - Pieces

/// The state ring: a pulsing record dot, a still pause glyph when stopped.
///
/// Used only where a *word* sits beside it (the status chip). On its own it is
/// the most generic mark the island can draw — timers, calls and screen
/// recording all use a red dot — which is why nothing else reaches for it.
private struct RecordIndicator: View {
  let isPaused: Bool
  let size: CGFloat

  var body: some View {
    Image(systemName: isPaused ? "pause.circle.fill" : "record.circle")
      .font(.system(size: size, weight: .medium))
      .foregroundStyle(isPaused ? Palette.paused : Palette.live)
      .modifier(PulsingSymbol(isActive: !isPaused))
  }
}

/**
 * The live audio mark. The identity of this activity.
 *
 * This is the only element that says "sound is arriving right now", so it
 * survives at a real size in every presentation instead of shrinking to a
 * decorative tick. It has to do that job standing still — see the motion note
 * above — and a red waveform does: red is recording, the waveform is audio, and
 * the pair is not what a timer, an alarm, a call or a navigation session puts in
 * the island.
 *
 * NO BACKGROUND SHAPE, and that is the change that mattered most. It used to sit
 * in a Capsule filled with `live.opacity(0.16)`. Inside the Dynamic Island —
 * which is itself a black pill — that drew a pill inside a pill, and 16% red on
 * black is not a tint, it is a dark maroon smudge about 30x20pt across. It also
 * made the two compact halves different *kinds* of object, a chip on the left
 * and bare numerals on the right, which is exactly what made them read as two
 * fragments either side of the camera rather than one pill. iOS puts a bare
 * glyph in compactLeading everywhere it ships one. The mass now comes from the
 * glyph's own point size, which is honest and costs no width.
 *
 * Scaled with `font(size:)` rather than `.resizable()` on purpose: a resizable
 * SF Symbol is no longer treated as a symbol and `symbolEffect` stops applying.
 */
private struct AudioIndicator: View {
  let isPaused: Bool
  let size: CGFloat
  var weight: Font.Weight = .regular

  var body: some View {
    Image(systemName: isPaused ? "waveform.slash" : "waveform")
      .font(.system(size: size, weight: weight))
      .foregroundStyle(isPaused ? Palette.paused : Palette.live)
      .modifier(VaryingSymbol(isActive: !isPaused))
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
      // TRUE EVERYWHERE, DELIBERATELY. This renders `0:00:07` from the first
      // second rather than `00:07`, which costs roughly 8pt of a ~60pt compact
      // region. `false` would buy that back, but Apple documents the flag as
      // "whether the hours component is shown", not "shown once needed", and an
      // hour-long meeting reading `05:12` is a wrong number on the one surface
      // that exists to report a number. Width is a taste problem; that is a
      // correctness problem.
      showsHours: true
    )
    // Monospaced digits are not a nicety here. This reflows every second inside
    // a fixed-width island region, and proportional figures make the whole pill
    // twitch on every tick.
    .font(.system(size: size, weight: weight, design: .rounded).monospacedDigit())
    .foregroundStyle(state.isPaused ? Palette.paused : Palette.label)
    // Insurance, not layout. The compact region is the narrowest surface in the
    // OS and the string grows a character at the one hour mark; scaling by a
    // sixth is invisible, being truncated to `1:23:4…` is not.
    .lineLimit(1)
    .minimumScaleFactor(0.85)
  }
}

private struct StatusLabel: View {
  let isPaused: Bool

  var body: some View {
    Text(isPaused ? "PAUSED" : "RECORDING")
      .font(.system(size: 10, weight: .semibold))
      .kerning(0.7)
      .foregroundStyle(isPaused ? Palette.paused : Palette.live)
      .lineLimit(1)
  }
}

/**
 * State glyph and state word, bound into one object.
 *
 * A bare ring beside a bare word reads as two things that happen to be near each
 * other. The capsule makes them one chip.
 *
 * ONLY USED ON FULL-WIDTH SURFACES — the Lock Screen card and the expanded
 * island's bottom region. It is ~100pt wide, and the expanded island's leading
 * region is the sliver beside the camera housing; it used to live there and had
 * nowhere near the room, so either it truncated or it squeezed the clock
 * opposite. Width this big belongs in a region that has width.
 *
 * The tint is the state, at 0.16 — the same weight the control capsules use, so
 * the card has one background language rather than two. It reads as a tint here
 * and not as a smudge because it sits on a card, at a size where 16% has room to
 * register.
 */
private struct StatusChip: View {
  let isPaused: Bool

  var body: some View {
    HStack(spacing: 5) {
      RecordIndicator(isPaused: isPaused, size: 12)
      StatusLabel(isPaused: isPaused)
    }
    .padding(.horizontal, 8)
    .padding(.vertical, 4)
    .background((isPaused ? Palette.paused : Palette.live).opacity(0.16), in: Capsule())
  }
}

/// Waveform and clock as a single reading, right-aligned.
///
/// Deliberately tight — 7pt — because the two are one fact, not two: *this much
/// audio, this long*. The clock keeps the hero size; the waveform is sized to
/// sit on its optical line rather than to fill space.
private struct LiveReadout: View {
  let state: RecordingActivityAttributes.ContentState
  let waveSize: CGFloat
  let clockSize: CGFloat

  var body: some View {
    HStack(alignment: .center, spacing: 7) {
      AudioIndicator(isPaused: state.isPaused, size: waveSize)
      ElapsedTime(state: state, size: clockSize, weight: .semibold)
    }
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
    // 44 is Apple's floor for a target you are expected to hit on a locked
    // screen without looking.
    .frame(height: 44)
    .background(tint.opacity(0.16), in: Capsule())
    .contentShape(Capsule())
  }
}

/**
 * Pause/Resume and End.
 *
 * On iOS 17+ these are real `Button(intent:)` controls that act in place — see
 * RecordingIntents.swift for why they reach the recorder without an App Group.
 * On 16.4–16.7 `Button(intent:)` does not exist, so rather than draw two buttons
 * that quietly do nothing, the row collapses to one honest link that opens the
 * app. A dead control is worse than an absent one.
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
    } else {
      Link(destination: AppLink.record) {
        ControlLabel(systemImage: "arrow.up.forward", title: "Open Puffin", tint: Palette.label)
      }
    }
  }
}

// MARK: - Lock Screen / banner

/**
 * Shown on the Lock Screen and as the banner on devices with no island, which is
 * every iPhone below the 14 Pro.
 *
 * TWO BANDS. The readout band answers all three questions a recording card
 * exists to answer, left to right in the order they are asked: *is it recording*
 * (the chip), *of what* (the title, tucked under the chip so it costs no band of
 * its own), *for how long* (waveform and clock, as one right-aligned reading).
 * Underneath it, the only two things you can do. Nothing floats; every element
 * is anchored to a neighbour.
 */
private struct RecordingLockScreenView: View {
  let context: ActivityViewContext<RecordingActivityAttributes>

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .center, spacing: 10) {
        VStack(alignment: .leading, spacing: 3) {
          StatusChip(isPaused: context.state.isPaused)

          // Only when the user actually named this. The recorder pre-fills the
          // title field with a timestamp, and rendering that here put a date
          // directly beneath the Lock Screen's own clock — see the JS side,
          // which sends an empty string rather than the placeholder.
          //
          // It hangs under the chip rather than taking a row, so the usual case
          // — no title — costs nothing, and the titled case costs 18pt instead
          // of a full band. It is also the one thing here that may be too long
          // for the card, so it is the one thing allowed to truncate.
          if !context.attributes.title.isEmpty {
            Text(context.attributes.title)
              .font(.system(size: 13, weight: .medium))
              .foregroundStyle(Palette.secondary)
              .lineLimit(1)
          }
        }

        Spacer(minLength: 8)

        // At 30pt the clock is unambiguously the thing being reported.
        // `layoutPriority` is what makes a long title truncate instead of
        // shoving the clock off the card.
        LiveReadout(state: context.state, waveSize: 24, clockSize: 30)
          .layoutPriority(1)
      }

      ControlRow(isPaused: context.state.isPaused)
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
  }
}

// MARK: - Widget

struct RecordingLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: RecordingActivityAttributes.self) { context in
      RecordingLockScreenView(context: context)
        // 0.92 of the app's own canvas, up from `black.opacity(0.55)`. This tint
        // composites over whatever wallpaper the user has; at 55% a bright photo
        // came through hard enough to put 0.62-opacity secondary text and the
        // desaturated paused grey under AA. Near-opaque also means the card is
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
         * camera housing, not halves of the screen — Apple sizes them to the
         * space beside the sensor. So they carry one object each, and every word
         * lives in `.bottom`, which is the only full-width region.
         *
         * That also makes the expansion read as the compact pill growing:
         * waveform left, clock right, in both. It previously put a ~100pt status
         * chip in the leading sliver against a ~90pt readout in the trailing
         * one, which on a 14 Pro is over budget once the housing is subtracted —
         * one of them had to compress or truncate, and which one was up to the
         * layout engine.
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
          VStack(spacing: 10) {
            // The words the compact pill has no room for. The chip is fixed
            // width and goes first; the title takes what is left and is the only
            // thing allowed to truncate.
            HStack(spacing: 8) {
              StatusChip(isPaused: paused)

              if !context.attributes.title.isEmpty {
                Text(context.attributes.title)
                  .font(.system(size: 14, weight: .medium))
                  .foregroundStyle(Palette.secondary)
                  .lineLimit(1)
              }

              Spacer(minLength: 0)
            }

            ControlRow(isPaused: paused)
          }
        }
      } compactLeading: {
        /*
         * THE SURFACE THAT MATTERS. This is visible whenever the phone is
         * unlocked and the recording is running — call it 99% of the activity's
         * life — and everything else in this file is a detail by comparison.
         *
         * A bare red waveform at 17pt. Three decisions, all of them reversals:
         *
         *  - No capsule behind it. See AudioIndicator: a tinted pill inside the
         *    island's own pill is what made the two halves look like fragments,
         *    not what fixed it.
         *  - 17pt, up from 13. The trailing side is ~50pt of monospaced numerals;
         *    a 13pt glyph opposite that is not a pair, it is a speck and a
         *    number. 17pt puts the waveform's height on the numerals' cap height,
         *    which is what actually balances the two sides across the housing.
         *  - Still the waveform and never a red dot. A dot is what the timer, the
         *    call and the screen recorder all draw. The waveform is the one mark
         *    that says *audio* before it says anything else.
         */
        AudioIndicator(isPaused: paused, size: 17, weight: .medium)
      } compactTrailing: {
        // 14pt semibold. The heaviest that still fits: each compact side is
        // roughly 60pt, and `h:mm:ss` at this size measures near 50pt. Already
        // monospaced — see ElapsedTime, where the digits are load-bearing rather
        // than a nicety — so the weight costs no width jitter as it ticks.
        //
        // This is the only guaranteed motion in the island. It is what makes the
        // pill alive even in the frames where the waveform is standing still.
        ElapsedTime(state: context.state, size: 14, weight: .semibold)
      } minimal: {
        /*
         * Shown when another activity holds the island and we are reduced to a
         * single circle roughly 22pt across.
         *
         * `waveform.circle.fill`, not the record ring. The old objection to the
         * waveform here was geometric and correct — the bare `waveform` glyph is
         * half again as wide as it is tall and would shrink until the bars merge
         * — but the enclosed variant is drawn square for exactly this case, it
         * fills the circle, and it is in SF Symbols' `variable` category, so the
         * bars still animate. So the smallest presentation keeps both the shape
         * of the region and the identity of the activity, instead of falling
         * back to the one mark every other live session in iOS also uses.
         */
        Image(systemName: paused ? "pause.circle.fill" : "waveform.circle.fill")
          .font(.system(size: 17, weight: .medium))
          .foregroundStyle(paused ? Palette.paused : Palette.live)
          .modifier(VaryingSymbol(isActive: !paused))
      }
      // Tints the hairline around the expanded island, so the live/paused state
      // is legible even in peripheral vision.
      .keylineTint(paused ? Palette.paused : Palette.live)
      .widgetURL(AppLink.record)
    }
  }
}
