import AppIntents
import Foundation

/**
 * The Dynamic Island's controls.
 *
 * THIS FILE IS COMPILED INTO TWO TARGETS, from this one copy. The widget
 * extension picks it up because it sits inside `targets/live-activity/`, which
 * `@bacons/apple-targets` synchronises wholesale; the app target gets it because
 * src/lib/live-activity/with-recording-intents.js copies it in at prebuild
 * (Apple requires it there — see below, and see that file for why the plugin's
 * own `_shared/` folder does not do the job). Everything here therefore has to
 * make sense in both processes.
 *
 * WHY `LiveActivityIntent` AND NOT `AppIntent`. From Apple's "Adding
 * interactivity to widgets and Live Activities":
 *
 *     "By default, the system runs the app intent in the same process as the
 *      widget extension. However, if the app intent's openAppWhenRun property
 *      is true, or if the intent conforms to AudioPlaybackIntent,
 *      ForegroundContinuableIntent, LiveActivityIntent, or
 *      PushToTalkTransmissionIntent, the system performs the app intent in the
 *      app's process."
 *
 *     "If you adopt the LiveActivityIntent or AudioPlaybackIntent protocol, the
 *      system runs the app intent in the app's process. Make sure to add your
 *      custom app intent to your app target."
 *
 * That single sentence is what makes real controls possible here at all. A
 * plain `AppIntent` would run inside the widget extension — a separate sandbox
 * that cannot see the app's AVAudioSession and cannot reach it without an App
 * Group, which is an entitlement a free Apple account cannot provision.
 * `LiveActivityIntent` runs in the app's own process, so no process boundary is
 * crossed and no entitlement is needed.
 *
 * WHY A RAW NOTIFICATION NAME AND NOT A SHARED SYMBOL. Running in the app's
 * process means `NotificationCenter.default` reaches the recorder bridge
 * directly. It is addressed by string rather than by importing the bridge's
 * module because this same file also has to compile inside the widget
 * extension, which does not link that pod. A string constant is the only
 * contract both sides can hold without linking against each other. The matching
 * observer is in modules/echobrief-live-activity/ios/RecordingActivityController.swift;
 * the two strings must agree.
 *
 * There is deliberately NO start intent. A widget extension cannot activate the
 * microphone, and iOS will not let an intent begin mic capture for an app that
 * is not already recording — capture has to be started by the foreground app.
 * The activity only exists while a recording is already running, so "start" has
 * no meaning here. A control that cannot work must not be drawn.
 */

/// Must match `RecordingActivityController.controlNotificationName`.
let echoBriefRecordingControlNotification = Notification.Name("EchoBriefRecordingControl")

/// Must match `RecordingActivityController.controlActionKey`.
let echoBriefRecordingControlActionKey = "action"

/// Hands an action to the app's recorder bridge. A no-op in the widget
/// extension, which never performs these intents.
private func postRecordingControl(_ action: String) {
  NotificationCenter.default.post(
    name: echoBriefRecordingControlNotification,
    object: nil,
    userInfo: [echoBriefRecordingControlActionKey: action]
  )
}

@available(iOS 17.0, *)
struct PauseRecordingIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Pause recording"
  static var description = IntentDescription("Pauses the recording in progress.")

  /// False on purpose. Pausing without leaving whatever you were doing is the
  /// entire reason this control is worth having; opening the app would defeat
  /// it. The app is already running — it holds the background audio session —
  /// so the intent reaches a live recorder.
  static var openAppWhenRun: Bool = false

  func perform() async throws -> some IntentResult {
    postRecordingControl("pause")
    return .result()
  }
}

@available(iOS 17.0, *)
struct ResumeRecordingIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Resume recording"
  static var description = IntentDescription("Resumes the paused recording.")
  static var openAppWhenRun: Bool = false

  func perform() async throws -> some IntentResult {
    postRecordingControl("resume")
    return .result()
  }
}

@available(iOS 17.0, *)
struct EndRecordingIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "End meeting"
  // User-visible in the Shortcuts app, so it says Puffin. The type name and the
  // notification string stay EchoBrief — they are identifiers.
  static var description = IntentDescription("Stops recording and returns to Puffin.")

  /// True, unlike the other two, and not for symmetry's sake. Ending a meeting
  /// hands off to an upload and a transcription flow that shows progress, can
  /// fail and needs to say so, and may ask for notification permission. None of
  /// that can happen behind a locked screen, and a background upload can be
  /// suspended mid-flight. So this stops the recorder and brings the app
  /// forward, where the normal end-of-meeting flow can run and be seen.
  static var openAppWhenRun: Bool = true

  func perform() async throws -> some IntentResult {
    postRecordingControl("end")
    return .result()
  }
}
