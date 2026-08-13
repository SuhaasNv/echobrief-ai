import ActivityKit
import Foundation

/**
 * Owns the one recording Live Activity, and the channel its buttons talk back
 * through.
 *
 * Everything here runs in the app's process — including the Live Activity's
 * controls, because they are `LiveActivityIntent`s and iOS performs those in the
 * app rather than in the widget extension. That is the whole reason this design
 * needs no App Group: nothing crosses a process boundary, so there is no shared
 * container to provision, so there is no entitlement, so code signing on a free
 * Apple account keeps working.
 */
final class RecordingActivityController {
  static let shared = RecordingActivityController()

  /// Must match the constant of the same value in
  /// targets/live-activity/RecordingIntents.swift. Addressed by string
  /// because that file also compiles into the widget extension, which cannot
  /// link this pod, so a shared symbol is not available to both sides.
  private static let controlNotificationName = Notification.Name("EchoBriefRecordingControl")
  private static let controlActionKey = "action"

  /// How long the system should consider the activity's contents trustworthy.
  ///
  /// This is the last line of defence against a stale "recording" pill. If the
  /// app is force-quit mid-recording, ActivityKit keeps the activity alive with
  /// no one left to update it; the launch sweep clears it the next time the app
  /// opens, but until then this is what makes iOS mark it as outdated. Four
  /// hours is well past any real meeting and well short of ActivityKit's own
  /// eight-hour ceiling.
  private static let staleAfter: TimeInterval = 4 * 60 * 60

  /// Called on whatever thread queued the action, once per queued control.
  /// The module turns this into a JS event.
  var onControlQueued: (() -> Void)?

  private let lock = NSLock()
  private var activity: Activity<RecordingActivityAttributes>?
  private var startedAt = Date()
  private var pausedAt: Date?
  private var pendingControls: [String] = []
  private var observer: NSObjectProtocol?

  private init() {}

  // MARK: - Capability

  /// False on a device where the user has switched Live Activities off, and on
  /// anything that cannot show them. Callers must treat it as "skip", never as
  /// an error: a recording that fails to start because its decoration failed is
  /// a far worse bug than a missing decoration.
  var areActivitiesEnabled: Bool {
    ActivityAuthorizationInfo().areActivitiesEnabled
  }

  // MARK: - Control channel

  func startObservingControls() {
    lock.lock()
    let alreadyObserving = observer != nil
    lock.unlock()
    guard !alreadyObserving else { return }

    let token = NotificationCenter.default.addObserver(
      forName: Self.controlNotificationName,
      object: nil,
      queue: nil
    ) { [weak self] note in
      guard
        let self,
        let action = note.userInfo?[Self.controlActionKey] as? String
      else { return }

      self.lock.lock()
      self.pendingControls.append(action)
      self.lock.unlock()

      // Queue first, then signal. JS drains the queue rather than reading the
      // event payload, so an action can never be lost to a listener that has
      // not attached yet — which is the normal case when iOS relaunches the app
      // to perform an intent.
      self.onControlQueued?()
    }

    lock.lock()
    observer = token
    lock.unlock()
  }

  func stopObservingControls() {
    lock.lock()
    let token = observer
    observer = nil
    pendingControls.removeAll()
    lock.unlock()

    if let token {
      NotificationCenter.default.removeObserver(token)
    }
  }

  func drainPendingControls() -> [String] {
    lock.lock()
    defer { lock.unlock() }
    let drained = pendingControls
    pendingControls.removeAll()
    return drained
  }

  // MARK: - Lifecycle

  /// Returns false when the activity could not be started. That is a normal
  /// outcome, not a failure to report: Live Activities may be disabled, or the
  /// app may not be in the foreground.
  @discardableResult
  func start(title: String) -> Bool {
    guard areActivitiesEnabled else { return false }

    lock.lock()
    if activity != nil {
      lock.unlock()
      return true
    }
    let now = Date()
    startedAt = now
    pausedAt = nil
    lock.unlock()

    let state = RecordingActivityAttributes.ContentState(startedAt: now, pausedAt: nil)
    do {
      let requested = try Activity.request(
        attributes: RecordingActivityAttributes(title: title),
        content: ActivityContent(state: state, staleDate: now.addingTimeInterval(Self.staleAfter)),
        // Explicit rather than defaulted. Passing a push type is the one thing
        // in ActivityKit that would demand an aps-environment entitlement, and
        // a free Apple account cannot sign one. Local updates only, forever.
        pushType: nil
      )
      lock.lock()
      activity = requested
      lock.unlock()
      return true
    } catch {
      return false
    }
  }

  func setPaused(_ paused: Bool) {
    lock.lock()
    guard let activity else {
      lock.unlock()
      return
    }
    let now = Date()
    if paused {
      if pausedAt == nil { pausedAt = now }
    } else if let pausedFrom = pausedAt {
      // Slide the origin forward by the paused duration. Without this the clock
      // would jump ahead on resume by however long the recording was paused,
      // and the island would disagree with the app's own timer.
      startedAt = startedAt.addingTimeInterval(now.timeIntervalSince(pausedFrom))
      pausedAt = nil
    }
    let state = RecordingActivityAttributes.ContentState(startedAt: startedAt, pausedAt: pausedAt)
    lock.unlock()

    Task {
      await activity.update(
        ActivityContent(state: state, staleDate: now.addingTimeInterval(Self.staleAfter))
      )
    }
  }

  func end() {
    lock.lock()
    let current = activity
    activity = nil
    pausedAt = nil
    lock.unlock()

    guard let current else { return }
    Task {
      // .immediate, not .default. The default policy leaves the activity on the
      // Lock Screen for up to four hours after it ends, which for a recording
      // indicator means a pill claiming to be recording when nothing is.
      await current.end(nil, dismissalPolicy: .immediate)
    }
  }

  /// Ends every recording activity this app has, including ones this process
  /// never created.
  ///
  /// Live Activities outlive the app that started them. If EchoBrief is
  /// force-quit or crashes mid-recording, the pill survives with nobody left to
  /// update it and no recording behind it. Sweeping on launch is the only
  /// reliable way to clear that, and it is unconditionally safe: audio capture
  /// cannot survive process death, so at launch there is never a recording for
  /// an activity to belong to.
  func endAll() {
    lock.lock()
    activity = nil
    pausedAt = nil
    lock.unlock()

    Task {
      for activity in Activity<RecordingActivityAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }
  }
}
