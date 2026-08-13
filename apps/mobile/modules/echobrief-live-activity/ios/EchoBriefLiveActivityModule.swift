import ExpoModulesCore

/// JS surface for the recording Live Activity.
///
/// Every function is safe to call on a device that cannot show one — they
/// return false or do nothing rather than throwing. Recording must never fail
/// because its Dynamic Island decoration failed.
public class EchoBriefLiveActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("EchoBriefLiveActivity")

    // Carries no payload on purpose. It is a "there is something waiting"
    // signal; JS answers it by calling drainPendingControls(), which is what
    // makes an action queued before JS was listening impossible to lose.
    Events("onRecordingControl")

    OnCreate {
      let controller = RecordingActivityController.shared

      // The orphan sweep, and the reason it lives here rather than in JS: this
      // runs when the native module registry is built, which is every app
      // launch, before any React code executes and whether or not the record
      // screen is ever mounted. A JS-side sweep would miss a launch that never
      // reaches that screen, and would miss it entirely if JS failed to boot.
      controller.endAll()

      controller.onControlQueued = { [weak self] in
        self?.sendEvent("onRecordingControl", [:])
      }
      controller.startObservingControls()
    }

    OnDestroy {
      let controller = RecordingActivityController.shared
      controller.stopObservingControls()
      controller.onControlQueued = nil
    }

    Function("areActivitiesEnabled") { () -> Bool in
      RecordingActivityController.shared.areActivitiesEnabled
    }

    Function("startActivity") { (title: String) -> Bool in
      RecordingActivityController.shared.start(title: title)
    }

    Function("setPaused") { (paused: Bool) -> Void in
      RecordingActivityController.shared.setPaused(paused)
    }

    Function("endActivity") { () -> Void in
      RecordingActivityController.shared.end()
    }

    Function("drainPendingControls") { () -> [String] in
      RecordingActivityController.shared.drainPendingControls()
    }
  }
}
