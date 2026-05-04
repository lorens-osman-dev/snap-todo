/**
 * extension.ts — SnapTodo Extension Entry Point
 *
 * Responsibility:
 * - Instantiate all subsystems in enable()
 * - Tear everything down cleanly in disable()
 * - Register the global keyboard shortcut
 * - Move the indicator between panel boxes when the position setting changes
 *
 * This file is intentionally thin. Business logic lives in:
 * services/todosService.ts  ← data
 * ui/indicator.ts           ← panel button + dropdown menu
 * ui/drawer.ts              ← slide-in drawer surface
 * ui/todoItem.ts            ← individual row widget
 * utils/tooltip.ts          ← hover tooltips
 * services/clipboard.ts     ← clipboard + notification
 * core/logger.ts            ← logging
 */

import Meta from "gi://Meta";
import Shell from "gi://Shell";
import Gio from "gi://Gio";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

import { Logger } from "./core/logger.js";
import { TodosService } from "./services/todosService.js";
import { SnapTodoIndicator } from "./ui/indicator.js";
import { TodoDrawer } from "./ui/drawer.js";

// ─── Extension Class ──────────────────────────────────────────────────────────

export default class SnapTodoExtension extends Extension {

  // ─── Owned subsystems ─────────────────────────────────────────────────────

  private _indicator: InstanceType<typeof SnapTodoIndicator> | null = null;
  private _drawer: TodoDrawer | null = null;
  private _service: TodosService | null = null;
  private _settings: Gio.Settings | null = null;

  private _positionChangedId: number = 0;
  private _startupCompleteId: number = 0;
  private _shortcutChangedId: number = 0;

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  override enable(): void {
    try {
      this._settings = this.getSettings() as unknown as Gio.Settings;
      this._service = new TodosService(this._settings);
      this._drawer = new TodoDrawer(this._service, this);
      this._indicator = new SnapTodoIndicator(
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

      // ─── Keybinding Registration (Wayland Cold-Boot Safe) ───

      // Centralized initialization callback for shortcuts
      const initShortcutSystem = () => {
        this._bindShortcut();

        // Watch for user changing the shortcut in Preferences and apply instantly
        this._shortcutChangedId = this._settings!.connect(
          "changed::toggle-shortcut",
          () => this._bindShortcut()
        );
      };

      // Protect against the Mutter cold-boot race condition
      if (Main.layoutManager._startingUp) {
        this._startupCompleteId = Main.layoutManager.connect("startup-complete", () => {
          initShortcutSystem();
          // CLEANUP: Fire once and detach
          Main.layoutManager.disconnect(this._startupCompleteId);
          this._startupCompleteId = 0;
        });
      } else {
        initShortcutSystem();
      }

      Logger.info("enabled");
    } catch (error) {
      Logger.error("enable()", error);
    }
  }

  override disable(): void {
    // CLEANUP: Prevent memory leaks from dangling Shell observers if disabled during startup
    if (this._startupCompleteId) {
      Main.layoutManager.disconnect(this._startupCompleteId);
      this._startupCompleteId = 0;
    }

    // CLEANUP: Always unbind shortcuts and their GSettings listeners
    this._unbindShortcut();
    if (this._shortcutChangedId && this._settings) {
      this._settings.disconnect(this._shortcutChangedId);
      this._shortcutChangedId = 0;
    }

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

  // ─── Keybinding Management ────────────────────────────────────────────────

  /**
   * Safely registers the global toggle shortcut with Mutter.
   * Includes IGNORE_AUTOREPEAT to prevent Wayland UI lockups if the user holds the key.
   */
  private _bindShortcut(): void {
    // CLEANUP: Always unbind before rebinding to prevent ghost listeners
    this._unbindShortcut();

    if (!this._settings) return;

    Main.wm.addKeybinding(
      "toggle-shortcut",
      this._settings,
      Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
      Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
      () => {
        if (this._settings?.get_boolean("use-drawer")) {
          // Drawer mode: toggle the slide-out drawer
          this._drawer?.toggle();
        } else {
          // Menu mode: toggle the panel dropdown menu
          if (this._indicator?.menu) {
            this._indicator.menu.toggle();
          }
        }
      },
    );
  }

  /**
   * Removes the global toggle shortcut from Mutter's key grabber.
   */
  private _unbindShortcut(): void {
    Main.wm.removeKeybinding("toggle-shortcut");
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