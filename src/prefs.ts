/**
 * prefs.ts — Snap Todo Preferences
 *
 * Runs in a separate GTK4/Adwaita process.
 * Debug: journalctl -f -o cat /usr/bin/gjs
 */

import Adw from "gi://Adw";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

// Ensure you include the .js extension for GJS module resolution
import { buildGeneralPage } from "./prefs/generalPage.js";
import { buildGuidePage } from "./prefs/guidePage.js";
import { buildAboutPage } from "./prefs/aboutPage.js";
import type Gio from "gi://Gio";
export default class LightTodoPreferences extends ExtensionPreferences {

  override fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
    // 1. Cast the return value to the locally resolved Gio.Settings
    const settings = this.getSettings() as unknown as Gio.Settings;

    // Extract the absolute installation path of the extension
    const extPath = this.dir.get_path();

    // 2. Now pass it to the factory function
    window.add(buildGeneralPage(settings, window));
    window.add(buildGuidePage());
    window.add(buildAboutPage(extPath));

    return Promise.resolve();
  }
}