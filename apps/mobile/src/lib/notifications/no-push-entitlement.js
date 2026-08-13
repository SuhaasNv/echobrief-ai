const { withEntitlementsPlist } = require("expo/config-plugins");

/**
 * Strips `aps-environment` from the generated iOS entitlements.
 *
 * THIS FILE IS LORE-BEARING. Do not remove it without reading all of this.
 *
 * EchoBrief signs with a FREE Apple developer account. Free accounts cannot
 * provision ANY entitlement, so an entitlements file containing even one key
 * fails code signing outright. The app therefore has to ship with a literally
 * empty `<dict/>`.
 *
 * `expo-notifications` fights that. Its config plugin does:
 *
 *     if (!config.modResults['aps-environment']) {
 *       config.modResults['aps-environment'] = mode;   // defaults to 'development'
 *     }
 *
 * There is no prop that turns this off — `mode` only chooses between
 * 'development' and 'production'. Worse, the plugin is applied AUTOMATICALLY by
 * Expo autolinking simply because the package is a dependency. Leaving it out
 * of the `plugins` array in app.json does nothing; verified by introspecting
 * the resolved config with `plugins: []` and finding `aps-environment` present.
 *
 * And `/ios` is gitignored (see .gitignore, "generated native folders"), so
 * `expo run:ios` regenerates the native project via prebuild and would rewrite
 * the entitlement back in on any clean checkout.
 *
 * So the only safe configuration is to let the plugin run and then delete the
 * key afterwards. Plugins listed in `app.json` -> `expo.plugins` run AFTER the
 * autolinked ones, so this mod is last and wins. This was verified empirically
 * with a real `npx expo prebuild` into a scratch project:
 *
 *   without this plugin -> <key>aps-environment</key><string>development</string>
 *   with this plugin    -> <dict/>
 *
 * This costs nothing, because EchoBrief only ever posts LOCAL notifications.
 * Local notifications go through UNUserNotificationCenter and require no
 * entitlement. `aps-environment` is only needed to register for REMOTE push.
 * The moment anyone calls `getExpoPushTokenAsync()` or
 * `registerForRemoteNotifications`, that call will fail at runtime, and the fix
 * is a paid developer account, NOT deleting this plugin.
 *
 * Keep this entry LAST in the `plugins` array.
 */
module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (modConfig) => {
    delete modConfig.modResults["aps-environment"];
    return modConfig;
  });
};
