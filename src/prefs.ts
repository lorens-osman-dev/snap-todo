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

    // NEW: Toggle to show/hide the top bar indicator entirely
    const showIndicatorRow = new Adw.SwitchRow({
      title: "Show Panel Indicator",
      subtitle: "Display the Light Todo button in the top bar",
    });
    settings.bind("show-indicator", showIndicatorRow, "active", Gio.SettingsBindFlags.DEFAULT);
    appearanceGroup.add(showIndicatorRow);

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
    // NEW: Toggle Drawer Mode
    const useDrawerRow = new Adw.SwitchRow({
      title: "Use Slide-out Drawer",
      subtitle: "Open todos in a full-height side panel instead of a menu",
    });
    settings.bind("use-drawer", useDrawerRow, "active", Gio.SettingsBindFlags.DEFAULT);
    appearanceGroup.add(useDrawerRow);
    // ── Group: Behavior ─────────────────────────────────────────────────────
    const behaviorGroup = new Adw.PreferencesGroup({
      title: "Behavior",
      description: "Configure input and interactions",
    });
    page.add(behaviorGroup);

    // Keyboard modifier combo
    const modifierRow = new Adw.ComboRow({
      title: "Keyboard Reorder Modifier",
      subtitle: "Hold this key with Up/Down arrows to move items",
    });
    const modifierModel = new Gtk.StringList();
    ["Alt", "Ctrl", "Shift"].forEach(m => modifierModel.append(m));
    modifierRow.set_model(modifierModel);

    const modifierMap: Record<string, number> = { alt: 0, ctrl: 1, shift: 2 };
    modifierRow.set_selected(modifierMap[settings.get_string("drag-modifier")] ?? 0);
    modifierRow.connect("notify::selected", () => {
      const modifiers = ["alt", "ctrl", "shift"];
      settings.set_string("drag-modifier", modifiers[modifierRow.get_selected()] ?? "alt");
    });


    behaviorGroup.add(modifierRow);

    // NEW: Dropdown to easily change the toggle shortcut modifier
    const shortcutRow = new Adw.ComboRow({
      title: "Toggle Shortcut",
      subtitle: "Global keyboard shortcut to open the todo panel",
    });

    const shortcutModel = new Gtk.StringList();

    // Define the safe options and their corresponding GNOME keybind strings
    const shortcutOptions = [
      { label: "Alt + T", value: "<Alt>t" },
      { label: "Ctrl + T", value: "<Control>t" },
      { label: "Shift + T", value: "<Shift>t" },
      { label: "Super + T", value: "<Super>t" },
    ];

    shortcutOptions.forEach(opt => shortcutModel.append(opt.label));
    shortcutRow.set_model(shortcutModel);

    // Read current setting and match it to our dropdown list
    const currentShortcut = settings.get_strv("toggle-shortcut")[0] ?? "<Alt>t";
    const currentIndex = shortcutOptions.findIndex(opt => opt.value === currentShortcut);

    // Fallback to 0 (Alt+T) if somehow an invalid string got in there
    shortcutRow.set_selected(Math.max(0, currentIndex));

    // Save the new shortcut back to GSettings when selected
    shortcutRow.connect("notify::selected", () => {
      const selectedValue = shortcutOptions[shortcutRow.get_selected()].value;
      settings.set_strv("toggle-shortcut", [selectedValue]);
    });

    behaviorGroup.add(shortcutRow);

    // ── Group: Data ─────────────────────────────────────────────────────────
    const dataGroup = new Adw.PreferencesGroup({
      title: "Data",
      description: "Manage your todo list data",
    });
    page.add(dataGroup);

    // ── 1. Uncheck Completed (Safe Action) ──
    const uncheckRow = new Adw.ActionRow({
      title: "Mark Completed as Active",
      subtitle: "Move all completed items back to your regular list",
    });
    const uncheckBtn = new Gtk.Button({
      label: "Uncheck",
      valign: Gtk.Align.CENTER,
      // Removed "destructive-action" so it renders as a neutral, standard Adwaita button
    });
    uncheckBtn.connect("clicked", () => {
      settings.set_strv("completed", []);
      window.add_toast(new Adw.Toast({ title: "Completed items moved to active" }));
    });
    uncheckRow.add_suffix(uncheckBtn as unknown as Gtk.Widget);
    dataGroup.add(uncheckRow);

    // ── 2. Delete Completed (Destructive Action) ──
    const deleteCompletedRow = new Adw.ActionRow({
      title: "Delete Completed Todos",
      subtitle: "Permanently remove all completed items from your list",
    });
    const deleteCompletedBtn = new Gtk.Button({
      label: "Delete",
      valign: Gtk.Align.CENTER,
      css_classes: ["destructive-action"], // Standard Adwaita red warning style
    });
    deleteCompletedBtn.connect("clicked", () => {
      const todos = settings.get_strv("todos");
      const completed = settings.get_strv("completed");
      const pinned = settings.get_strv("pinned");

      // Filter the underlying arrays to physically purge completed items
      const newTodos = todos.filter(t => !completed.includes(t));
      const newPinned = pinned.filter(t => !completed.includes(t));

      settings.set_strv("todos", newTodos);
      settings.set_strv("pinned", newPinned);
      settings.set_strv("completed", []);

      window.add_toast(new Adw.Toast({ title: "Completed todos permanently deleted" }));
    });
    deleteCompletedRow.add_suffix(deleteCompletedBtn as unknown as Gtk.Widget);
    dataGroup.add(deleteCompletedRow);

    // ── 3. Reset All Data (Destructive Action) ──
    const resetRow = new Adw.ActionRow({
      title: "Delete All Todos",
      subtitle: "This cannot be undone",
    });
    const resetBtn = new Gtk.Button({
      label: "Reset",
      valign: Gtk.Align.CENTER,
      css_classes: ["destructive-action"],
    });
    resetBtn.connect("clicked", () => {
      settings.set_strv("todos", []);
      settings.set_strv("completed", []);
      settings.set_strv("pinned", []); // CLEANUP: Ensure pinned array is also wiped
      window.add_toast(new Adw.Toast({ title: "All data deleted" }));
    });
    resetRow.add_suffix(resetBtn as unknown as Gtk.Widget);
    dataGroup.add(resetRow);

    // ── Group: Advanced ─────────────────────────────────────────────────────
    const advancedGroup = new Adw.PreferencesGroup({
      title: "Advanced",
      description: "Extension configuration management",
    });
    page.add(advancedGroup);

    const resetPrefsRow = new Adw.ActionRow({
      title: "Restore Default Settings",
      subtitle: "Reset all toggles, shortcuts, and layout options to their original values. Your todos will not be deleted.",
    });

    const resetPrefsBtn = new Gtk.Button({
      label: "Restore",
      valign: Gtk.Align.CENTER,
      // Destructive class used to warn the user that their customized UI config will be lost
      css_classes: ["destructive-action"],
    });

    resetPrefsBtn.connect("clicked", () => {
      // Define the keys that hold actual user data to protect them from the reset
      const dataKeys = ["todos", "completed", "pinned"];

      // 1. Reset the underlying schema values
      settings.list_keys().forEach(key => {
        if (!dataKeys.includes(key)) {
          settings.reset(key);
        }
      });

      // ── 2. SYNC UNBOUND UI ELEMENTS ──
      // SwitchRows use settings.bind() and update automatically. 
      // ComboRows use manual mapping, so we must force them to re-read the defaults.

      const posMap: Record<string, number> = { left: 0, center: 1, right: 2 };
      positionRow.set_selected(posMap[settings.get_string("panel-position")] ?? 2);

      const modMap: Record<string, number> = { alt: 0, ctrl: 1, shift: 2 };
      modifierRow.set_selected(modMap[settings.get_string("drag-modifier")] ?? 0);

      const currentShortcut = settings.get_strv("toggle-shortcut")[0] ?? "<Alt>t";
      const shortcutIndex = shortcutOptions.findIndex(opt => opt.value === currentShortcut);
      shortcutRow.set_selected(Math.max(0, shortcutIndex));

      // 3. Notify the user
      window.add_toast(new Adw.Toast({ title: "Settings restored to defaults" }));
    });

    resetPrefsRow.add_suffix(resetPrefsBtn as unknown as Gtk.Widget);
    advancedGroup.add(resetPrefsRow);



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