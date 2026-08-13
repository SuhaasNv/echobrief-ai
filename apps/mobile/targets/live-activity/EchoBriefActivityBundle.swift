import SwiftUI
import WidgetKit

/// Entry point for the extension.
///
/// There is exactly one widget in the bundle and it is a Live Activity, not a
/// Home Screen widget: EchoBrief has nothing worth showing on the Home Screen
/// that the app icon does not already say. Adding a `StaticConfiguration` here
/// later is additive and does not disturb the activity.
@main
struct EchoBriefActivityBundle: WidgetBundle {
  var body: some Widget {
    RecordingLiveActivity()
  }
}
