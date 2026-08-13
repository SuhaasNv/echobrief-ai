import ActivityKit
import Foundation

/// Shape of the recording Live Activity.
///
/// MIRRORED ON PURPOSE. A byte-equivalent declaration lives at
/// modules/echobrief-live-activity/ios/RecordingActivityAttributes.swift.
///
/// The duplication is not laziness, it is forced. Three separate compilation
/// units need this type: this widget extension, the app, and the Expo module.
/// The module builds as its own CocoaPods pod, and no Xcode target membership
/// can reach into a pod — not the extension's synchronised folder, and not the
/// prebuild mod that copies RecordingIntents.swift into the app target. So the
/// module keeps its own copy. This is also what the plugin author's own
/// live-activities reference app does.
///
/// ActivityKit pairs the app's `Activity<RecordingActivityAttributes>` with this
/// widget's `ActivityConfiguration(for:)` by the type's unqualified name and by
/// the Codable shape of ContentState. Drift does not fail the build: it produces
/// an activity that starts successfully and then renders nothing. If you touch
/// one of these files, touch the other in the same commit.
struct RecordingActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// The instant the elapsed clock counts up from — NOT the instant the user
    /// pressed Record. Every pause shifts it forward by however long the
    /// recording sat paused, so `now - startedAt` always equals real recorded
    /// time and the system can tick the clock without us sending anything.
    var startedAt: Date

    /// The instant the clock froze, or nil while running. Handed straight to
    /// `Text(timerInterval:pauseTime:)`, which stops advancing the display at
    /// this date. Sending a fresh timestamp every second instead would burn the
    /// activity's update budget and get us throttled by the system.
    var pausedAt: Date?

    /// Derived, so it is never encoded and can never disagree with `pausedAt`.
    var isPaused: Bool { pausedAt != nil }
  }

  /// Fixed for the life of the activity. The title field on the record screen is
  /// disabled while a recording is running, so it cannot change underneath us,
  /// which is exactly why it belongs in the static attributes rather than in
  /// ContentState where every read would cost an update.
  var title: String
}
