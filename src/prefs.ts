/**
 * prefs.ts — Light Todo Preferences
 *
 * Runs in a separate GTK4/Adwaita process.
 * Debug: journalctl -f -o cat /usr/bin/gjs
 */

import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

export default class LightTodoPreferences extends ExtensionPreferences {

  override fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
    const settings = this.getSettings();

    // ── Page: General ───────────────────────────────────────────────────────
    const page = new Adw.PreferencesPage({
      title: "General",
      icon_name: "preferences-system-symbolic",
    });
    window.add(page);

    // ── Group: Appearance ───────────────────────────────────────────────────
    const appearanceGroup = new Adw.PreferencesGroup({
      title: "Appearance",
      description: "Configure how Light Todo appears in your panel",
    });
    page.add(appearanceGroup);

    // Show completed toggle
    const showCompletedRow = new Adw.SwitchRow({
      title: "Show Completed Items",
      subtitle: "Display completed todos in the panel dropdown",
    });
    settings.bind("show-completed", showCompletedRow, "active", Gio.SettingsBindFlags.DEFAULT);
    appearanceGroup.add(showCompletedRow);

    // Panel position combo
    const positionRow = new Adw.ComboRow({
      title: "Panel Position",
      subtitle: "Where to place the indicator in the top bar",
    });
    const positionModel = new Gtk.StringList();
    ["Left", "Center", "Right"].forEach(p => positionModel.append(p));
    positionRow.set_model(positionModel);

    const positionMap: Record<string, number> = { left: 0, center: 1, right: 2 };
    positionRow.set_selected(positionMap[settings.get_string("panel-position")] ?? 2);
    positionRow.connect("notify::selected", () => {
      const positions = ["left", "center", "right"];
      settings.set_string("panel-position", positions[positionRow.get_selected()] ?? "right");
    });
    appearanceGroup.add(positionRow);

    // ── Group: Data ─────────────────────────────────────────────────────────
    const dataGroup = new Adw.PreferencesGroup({
      title: "Data",
      description: "Manage your todo list data",
    });
    page.add(dataGroup);

    // Clear completed
    const clearRow = new Adw.ActionRow({
      title: "Clear Completed Todos",
      subtitle: "Remove all completed items from your list",
    });
    const clearBtn = new Gtk.Button({
      label: "Clear",
      valign: Gtk.Align.CENTER,
      css_classes: ["destructive-action"],
    });
    clearBtn.connect("clicked", () => {
      settings.set_strv("completed", []);
      window.add_toast(new Adw.Toast({ title: "Completed todos cleared" }));
    });
    clearRow.add_suffix(clearBtn as unknown as Gtk.Widget);
    dataGroup.add(clearRow);

    // Reset all
    const resetRow = new Adw.ActionRow({
      title: "Reset All Data",
      subtitle: "Delete all todos — this cannot be undone",
    });
    const resetBtn = new Gtk.Button({
      label: "Reset",
      valign: Gtk.Align.CENTER,
      css_classes: ["destructive-action"],
    });
    resetBtn.connect("clicked", () => {
      settings.set_strv("todos", []);
      settings.set_strv("completed", []);
      window.add_toast(new Adw.Toast({ title: "All todos deleted" }));
    });
    resetRow.add_suffix(resetBtn as unknown as Gtk.Widget);
    dataGroup.add(resetRow);

    // ── Page: About ─────────────────────────────────────────────────────────
    const aboutPage = new Adw.PreferencesPage({
      title: "About",
      icon_name: "help-about-symbolic",
    });
    window.add(aboutPage);

    const aboutGroup = new Adw.PreferencesGroup({ title: "Light Todo" });
    aboutPage.add(aboutGroup);
    aboutGroup.add(new Adw.ActionRow({ title: "Version", subtitle: "1.0.0" }));
    aboutGroup.add(new Adw.ActionRow({ title: "Author", subtitle: "Your Name" }));

    return Promise.resolve();
  }
}