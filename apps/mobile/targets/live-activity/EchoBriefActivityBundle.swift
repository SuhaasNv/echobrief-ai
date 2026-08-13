import SwiftUI
import WidgetKit

/// Entry point for the extension.
///
/// Two widgets, and they are unrelated by design. The Live Activity monitors a
/// recording that is already running — it can never start one, because a widget
/// extension cannot activate the microphone (see RecordingIntents.swift). The
/// Home Screen widget can only start one, because it has no way to read whether
/// anything is running (see PuffinHomeWidgets.swift). Between them they cover
/// both halves; neither can do the other's job.
///
/// The bundle's own type name stays `EchoBrief…`. Identifiers across this target
/// are deliberately unchanged by the Puffin rename: the bundle id is registered
/// against a free team that may only create ten App IDs a week, and
/// `PuffinQuickActionsWidget.kind` keys placed widgets. Only user-visible
/// strings say Puffin.
@main
struct EchoBriefActivityBundle: WidgetBundle {
  var body: some Widget {
    RecordingLiveActivity()
    PuffinQuickActionsWidget()
  }
}
