import SwiftUI
import WidgetKit

/**
 * Home Screen and Lock Screen widgets.
 *
 * WHAT THIS WIDGET CAN AND CANNOT KNOW — read this before adding anything.
 *
 * It knows NOTHING about the user. Not their meetings, not their action items,
 * not how many minutes they recorded this week. A widget extension is a separate
 * process with its own container; the only supported way to hand it the app's
 * data is a shared App Group, and this project cannot have one. Puffin signs
 * with a FREE Apple developer account, which cannot provision any entitlement —
 * see expo-target.config.js, where the deliberate ABSENCE of an `entitlements`
 * key is what keeps this extension signable at all. Adding
 * `com.apple.security.application-groups` to app.json would mirror it into a
 * generated entitlements file and break signing for the whole build.
 *
 * So this file does not pretend. There is no fake "3 meetings this week" tile
 * and no placeholder list that never fills in. Everything below is either a
 * navigation surface or a constant, and every one of them is honest at 3am on a
 * device that has been offline for a week.
 *
 * WHAT WOULD LIGHT UP DATA, EXACTLY, if the account ever becomes a paid one:
 *   1. Add `ios.entitlements["com.apple.security.application-groups"] =
 *      ["group.com.suhaasnv.echobrief"]` in app.json, and add
 *      `entitlements: {}` to expo-target.config.js so the plugin mirrors it into
 *      the extension.
 *   2. On the JS side, after every meetings-list fetch, write a small JSON blob
 *      (title, endedAt, durationSeconds, status — five rows is plenty) into
 *      `UserDefaults(suiteName: "group.com.suhaasnv.echobrief")`, then call
 *      `WidgetCenter.shared.reloadTimelines(ofKind:)`.
 *   3. Read it back in `QuickActionsProvider.getTimeline` and give systemMedium
 *      the recent-meetings list it wants to be.
 * Until all three exist, do not add a view that implies any of them.
 *
 * REFRESH BUDGET: zero. The timeline is one entry with `.never`, because nothing
 * here is time-dependent. WidgetKit's refresh allowance is a scarce resource and
 * a static tile has no business spending any of it.
 *
 * NO systemLarge, ON PURPOSE. Large is 4x small and there is nothing to fill it
 * with — four navigation rows in a space that size is a screenshot of empty. It
 * becomes worth adding the day step 2 above exists and it can show a real list.
 */

// MARK: - Timeline

private struct QuickActionsEntry: TimelineEntry {
  let date: Date
}

private struct QuickActionsProvider: TimelineProvider {
  func placeholder(in context: Context) -> QuickActionsEntry {
    QuickActionsEntry(date: Date())
  }

  func getSnapshot(in context: Context, completion: @escaping (QuickActionsEntry) -> Void) {
    completion(QuickActionsEntry(date: Date()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<QuickActionsEntry>) -> Void) {
    // One entry, never reloaded. See the note on refresh budget above.
    completion(Timeline(entries: [QuickActionsEntry(date: Date())], policy: .never))
  }
}

// MARK: - Background

private extension View {
  /// iOS 17 made `containerBackground` mandatory: a widget without one renders
  /// with no background at all on 17+, which reads as a rendering bug rather
  /// than as a design. The extension still deploys to 16.4, hence the branch.
  @ViewBuilder
  func widgetCanvas<S: ShapeStyle>(_ style: S) -> some View {
    if #available(iOS 17.0, *) {
      containerBackground(style, for: .widget)
    } else {
      background(style)
    }
  }
}

// MARK: - Pieces

/**
 * The record mark.
 *
 * A tinted circle behind the waveform, which is the exact treatment that was
 * deleted from the Dynamic Island's compact leading — and the reversal is the
 * point. There, a 30pt tinted pill sat inside the island's own black pill and
 * read as a smudge. Here it sits on a 150pt card with nothing else competing,
 * at a size where 18% red resolves as a tint, and it is doing a job the island's
 * could not: making an otherwise flat tile read as a *button* you press.
 */
private struct RecordMark: View {
  let diameter: CGFloat
  let glyph: CGFloat

  var body: some View {
    ZStack {
      Circle().fill(Palette.live.opacity(0.18))
      Image(systemName: "waveform")
        .font(.system(size: glyph, weight: .medium))
        .foregroundStyle(Palette.live)
    }
    .frame(width: diameter, height: diameter)
  }
}

/// One secondary destination. Home Screen widgets have no hover and no pressed
/// state, so the filled surface is the only thing that says "this is tappable".
private struct NavRow: View {
  let systemImage: String
  let title: String
  let url: URL

  var body: some View {
    Link(destination: url) {
      HStack(spacing: 9) {
        Image(systemName: systemImage)
          .font(.system(size: 13, weight: .semibold))
          .foregroundStyle(Palette.tint)
          // Fixed width so the three labels start on one line rather than
          // stepping in and out with each glyph's natural width.
          .frame(width: 18)
        Text(title)
          .font(.system(size: 14, weight: .medium))
          .foregroundStyle(Palette.label)
          .lineLimit(1)
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 10)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
      .background(Palette.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
  }
}

/// The primary tile, shared by small and medium so the two sizes are one design
/// at two scales rather than two designs.
private struct RecordCard: View {
  let markDiameter: CGFloat
  let markGlyph: CGFloat
  let titleSize: CGFloat
  let padding: CGFloat

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      RecordMark(diameter: markDiameter, glyph: markGlyph)
      Spacer(minLength: 8)
      Text("Record")
        .font(.system(size: titleSize, weight: .semibold, design: .rounded))
        .foregroundStyle(Palette.label)
      Text("New meeting")
        .font(.system(size: 11, weight: .medium))
        .foregroundStyle(Palette.secondary)
        .lineLimit(1)
    }
    .padding(padding)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .background(Palette.live.opacity(0.12), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
  }
}

// MARK: - Families

/**
 * systemSmall — one job: get to the record screen.
 *
 * WHY THIS AND NOT "MINUTES THIS WEEK". Partly because the minutes are
 * unreachable (see the file header), but it would lose on the merits anyway. A
 * stat tile is read once and then ignored; this one is pressed. And the thing it
 * saves is not a tap, it is the wrong seconds: the meeting has already started
 * by the time you reach for the phone, and unlock → find icon → app opens on
 * whatever screen it was last on → find Record is four decisions where this is
 * one. It is also the only widget that can beat the app icon, which is the bar a
 * small widget has to clear to deserve a slot on the Home Screen at all.
 */
private struct SmallView: View {
  var body: some View {
    RecordCard(markDiameter: 46, markGlyph: 21, titleSize: 22, padding: 14)
  }
}

/**
 * systemMedium — the record tile, plus the three places you go when you are not
 * recording.
 *
 * Medium is roughly twice small, so the honest question is what the second half
 * earns. Recent meetings would be the right answer and cannot be built (file
 * header). A second copy of the record button would be padding. So the extra
 * width goes to the app's other three top-level destinations, each its own tap
 * target via `Link` — which is the one thing a medium widget can do that a small
 * one cannot.
 *
 * The 50/50 split is deliberate rather than lazy: it holds on every device width
 * without a fixed measurement, and Record keeps visual primacy through its red
 * fill and its larger type instead of through area.
 */
private struct MediumView: View {
  var body: some View {
    HStack(spacing: 10) {
      Link(destination: AppLink.record) {
        RecordCard(markDiameter: 38, markGlyph: 17, titleSize: 18, padding: 12)
      }

      VStack(spacing: 6) {
        NavRow(systemImage: "list.bullet.rectangle", title: "Meetings", url: AppLink.meetings)
        NavRow(systemImage: "sparkles", title: "Ask", url: AppLink.ask)
        NavRow(systemImage: "checklist", title: "Action items", url: AppLink.actions)
      }
    }
  }
}

/**
 * accessoryCircular — the Lock Screen, and arguably the best of the four.
 *
 * It is one tap from a locked, dark screen to a running recording, which is the
 * shortest path this app can offer anywhere. It also needs no data at all, so
 * the constraint that hollows out the medium widget costs this one nothing.
 *
 * No colour: the Lock Screen renders accessory widgets in a vibrant monochrome
 * material and discards `foregroundStyle`. Setting the brand red here would not
 * fail, it would simply be ignored — so the glyph has to carry the meaning
 * alone, which is why it is the waveform and not a dot.
 */
private struct CircularView: View {
  var body: some View {
    ZStack {
      AccessoryWidgetBackground()
      Image(systemName: "waveform")
        .font(.system(size: 18, weight: .semibold))
    }
  }
}

/// accessoryRectangular — same tap, with room to name itself. Worth having
/// because the circular slot is contested and this one usually is not.
private struct RectangularView: View {
  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: "waveform.circle.fill")
        .font(.system(size: 22, weight: .regular))
      VStack(alignment: .leading, spacing: 1) {
        Text("EchoBrief").font(.headline)
        Text("Start recording").font(.caption)
      }
      Spacer(minLength: 0)
    }
  }
}

// MARK: - Widget

private struct QuickActionsView: View {
  @Environment(\.widgetFamily) private var family

  var body: some View {
    switch family {
    case .systemMedium:
      MediumView()
        .widgetCanvas(Palette.canvas)
        // Fallback only. Every meaningful region of the medium layout is already
        // inside a `Link`; this catches the gaps between them, and sending those
        // to Record rather than nowhere is the difference between a widget that
        // feels dead and one that does not.
        .widgetURL(AppLink.record)
    case .accessoryCircular:
      // Clear, not the canvas: an accessory widget paints its own material and a
      // solid background would draw a black disc on the Lock Screen.
      CircularView()
        .widgetCanvas(Color.clear)
        .widgetURL(AppLink.record)
    case .accessoryRectangular:
      RectangularView()
        .widgetCanvas(Color.clear)
        .widgetURL(AppLink.record)
    default:
      SmallView()
        .widgetCanvas(Palette.canvas)
        .widgetURL(AppLink.record)
    }
  }
}

struct PuffinQuickActionsWidget: Widget {
  /// PERMANENT. iOS keys every widget a user has placed by this string; changing
  /// it does not migrate them, it orphans them and they vanish from the Home
  /// Screen. It stays "Puffin…" rather than "EchoBrief…" only because nothing
  /// has shipped yet — after the first install it is frozen.
  private let kind = "PuffinQuickActions"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: QuickActionsProvider()) { _ in
      QuickActionsView()
    }
    // Both strings are user-visible in the widget gallery.
    .configurationDisplayName("EchoBrief")
    .description("Start recording a meeting, or jump straight to Meetings, Ask and Action items.")
    .supportedFamilies([
      .systemSmall,
      .systemMedium,
      .accessoryCircular,
      .accessoryRectangular,
    ])
  }
}
