/**
 * Widget extension that hosts the recording Live Activity.
 *
 * THERE IS NO `entitlements` KEY HERE, AND THAT IS LOAD-BEARING.
 *
 * EchoBrief signs with a FREE Apple developer account, which cannot provision
 * any entitlement — see src/lib/notifications/no-push-entitlement.js for the
 * full story. `@bacons/apple-targets` gates its entitlements handling on the
 * TRUTHINESS of this key:
 *
 *     let entitlementsJson = props.entitlements;
 *     if (entitlementsJson) { ...applyDefaultEntitlements()... }
 *
 * so writing `entitlements: {}` is NOT the same as omitting it. An empty object
 * is truthy, which makes the plugin run applyDefaultEntitlements(), and because
 * the registry marks `widget` as `appGroupsByDefault: true` that mirrors
 * `ios.entitlements['com.apple.security.application-groups']` from app.json
 * into a generated entitlements file and points CODE_SIGN_ENTITLEMENTS at it.
 * The plugin's own live-activities demo ships exactly that mistake and has a
 * committed generated.entitlements full of app groups to prove it.
 *
 * With the key absent and no *.entitlements file in this folder, the plugin
 * calls `target.removeBuildSetting("CODE_SIGN_ENTITLEMENTS")` and the extension
 * signs with no entitlements at all. Live Activities need none: ActivityKit
 * requires only the NSSupportsLiveActivities Info.plist key on the app target,
 * and App Groups would only be needed to share data across the process
 * boundary — which this design never crosses (see RecordingIntents.swift).
 *
 * Do not add an `entitlements` object here. Do not add app groups to app.json
 * either; they get mirrored in from there.
 *
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
module.exports = {
  type: "widget",
  // Xcode target / product name. An identifier — renaming it churns the
  // pbxproj and the .appex path for nothing.
  name: "EchoBriefActivity",
  // CFBundleDisplayName. USER-VISIBLE: Settings -> Face ID & Passcode -> Live
  // Activities lists the extension by this name, so it says Puffin. Safe to
  // change; it is not part of the App ID.
  displayName: "Puffin Recording",
  // Leading dot appends to the app's identifier -> com.suhaasnv.echobrief.activity.
  // A free team may only register 10 App IDs per 7 days and this burns one, so
  // treat it as permanent: renaming it costs another slot every time.
  bundleIdentifier: ".activity",
  // Matched to the app target rather than the plugin's 18.0 default. The app
  // supports iOS 16.4, and an extension built against a higher floor simply
  // would not load there — the activity would be requested successfully and
  // then render nothing. Interactive controls are gated at 17.0 in Swift.
  deploymentTarget: "16.4",
};
