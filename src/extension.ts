/**
 * extension.ts — Light Todo GNOME Shell Extension
 *
 * Responsibility: Thin entry point. Handles GNOME Shell lifecycle (enable/disable),
 * binding to the top panel, and registering Wayland keybindings.
 */

import Meta from "gi://Meta";
import Shell from "gi://Shell";
import Gio from "gi://Gio";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

import { Logger } from "./core/logger.js";
import { LightTodoIndicator } from "./ui/indicator.js";

export default class LightTodoExtension extends Extension {
  private _indicator: InstanceType<typeof LightTodoIndicator> | null = null;
  private _settings: Gio.Settings | null = null;
  private _positionChangedId: number = 0;

  override enable(): void {
    try {
      this._settings = this.getSettings() as unknown as Gio.Settings;
      this._indicator = new LightTodoIndicator(this._settings, this);

      Main.panel.addToStatusArea(this.uuid, this._indicator);

      this._positionChangedId = this._settings.connect("changed::panel-position", () => this._updatePosition());
      this._updatePosition();

      Main.wm.addKeybinding(
        "toggle-shortcut",
        this._settings,
        Meta.KeyBindingFlags.NONE,
        Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
        () => {
          if (this._indicator && this._indicator.menu) {
            this._indicator.menu.toggle();
          }
        }
      );

      Logger.info(`LightTodo enabled`);
    } catch (error) {
      Logger.error(`from enable()`, error);
    }
  }

  private _updatePosition(): void {
    if (!this._indicator || !this._settings) return;

    const pos = this._settings.get_string("panel-position");
    const parent = this._indicator.get_parent();

    if (parent) parent.remove_child(this._indicator);

    const panel = Main.panel as any;
    if (pos === "left") panel._leftBox.insert_child_at_index(this._indicator, panel._leftBox.get_n_children());
    else if (pos === "center") panel._centerBox.insert_child_at_index(this._indicator, panel._centerBox.get_n_children());
    else panel._rightBox.insert_child_at_index(this._indicator, 0);
  }

  override disable(): void {
    try {
      if (this._settings && this._positionChangedId) {
        this._settings.disconnect(this._positionChangedId);
        this._positionChangedId = 0;
      }

      Main.wm.removeKeybinding("toggle-shortcut");
      this._indicator?.destroy();
      this._indicator = null;
      this._settings = null;
      Logger.info(`LightTodo disabled`);
    } catch (error) {
      Logger.error(`from disable()`, error);

    }
  }
}