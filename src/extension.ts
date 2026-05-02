/**
 * extension.ts — LightTodo Extension Entry Point
 *
 * Responsibility:
 *   - Instantiate all subsystems in enable()
 *   - Tear everything down cleanly in disable()
 *   - Register the global keyboard shortcut
 *   - Move the indicator between panel boxes when the position setting changes
 *
 * This file is intentionally thin. Business logic lives in:
 *   services/todosService.ts  ← data
 *   ui/indicator.ts           ← panel button + dropdown menu
 *   ui/drawer.ts              ← slide-in drawer surface
 *   ui/todoItem.ts            ← individual row widget
 *   utils/tooltip.ts          ← hover tooltips
 *   services/clipboard.ts     ← clipboard + notification
 *   core/logger.ts            ← logging
 */

import Meta from "gi://Meta";
import Shell from "gi://Shell";
import Gio from "gi://Gio";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

import { Logger } from "./core/logger.js";
import { TodosService } from "./services/todosService.js";
import { LightTodoIndicator } from "./ui/indicator.js";
import { TodoDrawer } from "./ui/drawer.js";

// ─── Extension Class ──────────────────────────────────────────────────────────

export default class LightTodoExtension extends Extension {

  // ─── Owned subsystems ─────────────────────────────────────────────────────

  private _indicator: InstanceType<typeof LightTodoIndicator> | null = null;
  private _drawer: TodoDrawer | null = null;
  private _service: TodosService | null = null;
  private _settings: Gio.Settings | null = null;
  private _positionChangedId: number = 0;

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  override enable(): void {
    try {
      this._settings = this.getSettings() as unknown as Gio.Settings;
      this._service = new TodosService(this._settings);
      this._drawer = new TodoDrawer();
      this._indicator = new LightTodoIndicator(
        this._settings,
        this._service,
        this._drawer,
        this,
      );

      // Register with the panel (makes it accessible by UUID)
      Main.panel.addToStatusArea(this.uuid, this._indicator);

      // Apply the configured panel position, then watch for changes
      this._positionChangedId = this._settings.connect(
        "changed::panel-position",
        () => this._updatePosition(),
      );
      this._updatePosition();

      // Global keyboard shortcut (reads the keybinding from GSettings automatically)
      Main.wm.addKeybinding(
        "toggle-shortcut",
        this._settings,
        Meta.KeyBindingFlags.NONE,
        Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
        () => {
          if (this._indicator) {
            // Use the new routing method instead of hardcoding menu.toggle()
            this._indicator.toggleUI();
          }
        }
      );

      Logger.info("enabled");
    } catch (error) {
      Logger.error("enable()", error);
    }
  }

  override disable(): void {
    // Remove global shortcut first (references indicator)
    Main.wm.removeKeybinding("toggle-shortcut");

    // Disconnect panel-position watcher
    if (this._settings && this._positionChangedId) {
      this._settings.disconnect(this._positionChangedId);
      this._positionChangedId = 0;
    }

    // Destroy UI (indicator's own destroy() handles its signal cleanup)
    this._indicator?.destroy();
    this._indicator = null;

    // Destroy drawer (removes its actors from the UI group)
    this._drawer?.destroy();
    this._drawer = null;

    // Release references
    this._service = null;
    this._settings = null;

    Logger.info("disabled");
  }

  // ─── Panel Position ───────────────────────────────────────────────────────

  /**
   * Move the indicator actor to the correct panel box (left / center / right).
   * Uses internal panel boxes because the public API doesn't expose
   * arbitrary position control.
   */
  private _updatePosition(): void {
    if (!this._indicator || !this._settings) return;

    const pos = this._settings.get_string("panel-position");
    const panel = Main.panel as any;

    // Remove from current parent box
    const parent = this._indicator.get_parent();
    if (parent) parent.remove_child(this._indicator);

    // Insert into the requested box
    if (pos === "left") {
      panel._leftBox.insert_child_at_index(
        this._indicator,
        panel._leftBox.get_n_children(),
      );
    } else if (pos === "center") {
      panel._centerBox.insert_child_at_index(
        this._indicator,
        panel._centerBox.get_n_children(),
      );
    } else {
      // Default: right
      panel._rightBox.insert_child_at_index(this._indicator, 0);
    }
  }
}