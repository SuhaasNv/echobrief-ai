const fs = require("fs");
const path = require("path");

const { IOSConfig } = require("expo/config-plugins");

/**
 * Compiles targets/live-activity/RecordingIntents.swift into the MAIN APP
 * TARGET as well as the widget extension.
 *
 * WHY THIS EXISTS AT ALL. The Live Activity's Pause / Resume / End buttons are
 * `LiveActivityIntent`s, and Apple is explicit about where those run and what
 * that costs you ("Adding interactivity to widgets and Live Activities"):
 *
 *     "If you adopt the LiveActivityIntent or AudioPlaybackIntent protocol, the
 *      system runs the app intent in the app's process. Make sure to add your
 *      custom app intent to your app target."
 *
 * Running in the app's process is the entire reason these controls can work on
 * a free Apple developer account: the intent can touch the live recorder
 * directly, so nothing has to cross into the widget extension's sandbox, so no
 * App Group is needed, so no entitlement is needed, so code signing survives.
 * But the system can only perform an intent it can find in the app binary. If
 * the type is missing from the app target the buttons draw fine and then do
 * nothing at all — a dead control, which is worse than no control.
 *
 * WHY NOT `@bacons/apple-targets`' `_shared/` FOLDER. That is the mechanism the
 * plugin nominally provides for exactly this, and it does not currently do the
 * job. Putting the file in `targets/live-activity/_shared/` emits:
 *
 *     PBXFileSystemSynchronizedBuildFileExceptionSet {
 *       target = Puffin;                              // the app
 *       membershipExceptions = ( _shared/RecordingIntents.swift );
 *     }
 *
 * but the enclosing PBXFileSystemSynchronizedRootGroup is listed only in the
 * WIDGET target's `fileSystemSynchronizedGroups`. An exception set for a target
 * that does not have the group is inert, and `membershipExceptions` is a list of
 * files to EXCLUDE in the first place. Verified by reading the generated
 * project.pbxproj after a prebuild. So the file would have compiled into the
 * extension only, and the buttons would have been dead.
 *
 * The source of truth stays in `targets/live-activity/` next to the SwiftUI
 * that references it; this mod copies it, so the two target memberships can
 * never drift the way two hand-maintained copies would. `withBuildSourceFile`
 * is idempotent — it checks `project.hasFile` before linking — so re-running
 * prebuild without `--clean` does not add a duplicate build file.
 *
 * @type {import('expo/config-plugins').ConfigPlugin}
 */
module.exports = function withRecordingIntents(config) {
  const source = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "targets",
    "live-activity",
    "RecordingIntents.swift",
  );

  if (!fs.existsSync(source)) {
    throw new Error(
      `[live-activity] Expected the Live Activity intents at ${source}. Without them in the app target the Dynamic Island's controls compile but never run.`,
    );
  }

  const contents = [
    "// GENERATED — DO NOT EDIT.",
    "// Copied verbatim from targets/live-activity/RecordingIntents.swift by",
    "// src/lib/live-activity/with-recording-intents.js on every prebuild, so this",
    "// intent exists in the app target as well as the widget extension. Edit the",
    "// original; edits here are overwritten.",
    "",
    fs.readFileSync(source, "utf8"),
  ].join("\n");

  return IOSConfig.XcodeProjectFile.withBuildSourceFile(config, {
    filePath: "RecordingIntents.swift",
    contents,
    overwrite: true,
  });
};
