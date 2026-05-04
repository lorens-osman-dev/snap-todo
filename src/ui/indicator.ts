/**
 * ui/indicator.ts — Panel Button Orchestrator
 *
 * Responsibility:
 * - Render the top-bar button (icon + count label)
 * - Orchestrate connections between the Panel Button, Drawer, and Menu
 * - Track top-level visibility and panel interactions
 *
 * Does NOT:
 * - Construct or style the inner dropdown menu items (see TodoMenu)
 */

import GObject from "gi://GObject";
import St from "gi://St";
import Gio from "gi://Gio";
import Clutter from "gi://Clutter";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import { TodosService } from "../services/todosService.js";
import { TodoDrawer } from "./drawer.js";
import { TodoMenu } from "./menu.js";
import { PopupMenu } from "resource:///org/gnome/shell/ui/popupMenu.js";

// ─── Registration ─────────────────────────────────────────────────────────────

export const SnapTodoIndicator = GObject.registerClass(
  class SnapTodoIndicator extends PanelMenu.Button {

    // ─── Private State ────────────────────────────────────────────────────────

    private _settings: Gio.Settings;
    private _service: TodosService;
    private _drawer: TodoDrawer;
    private _extension: Extension;
    private _todoMenu: TodoMenu;

    // Signal connection IDs
    private _settingsChangedId: number = 0;

    // Panel actors
    private _panelLabel!: St.Label;
    private _panelBox!: St.BoxLayout;

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(
      settings: Gio.Settings,
      service: TodosService,
      drawer: TodoDrawer,
      extension: Extension,
    ) {
      super(0.0, "Snap Todo", false);
      this._settings = settings;
      this._service = service;
      this._drawer = drawer;
      this._extension = extension;

      this._buildPanel();

      // Delegate popup menu construction to our specialized manager
      this._todoMenu = new TodoMenu(
        this.menu as PopupMenu,
        this._settings,
        this._service,
        this._drawer,
        this._extension
      );

      this._refresh();

      // ── Drawer UI Wiring ───
      this._drawer.addBtn.connect("clicked", () => this._addFromDrawer());
      this._drawer.entry.clutter_text.connect("activate", () => this._addFromDrawer());

      // ── Visibility & Data bindings ───
      this._updateVisibility();
      this._settings.connect("changed::show-indicator", () => this._updateVisibility());

      // CLEANUP: Bound heavily to ensure destroyed when extension is disabled
      this._settingsChangedId = this._settings.connect("changed", () => this._refresh());

      // ── Input Handling (Pointer Events) ───
      this.connect("button-press-event", (_actor: unknown, event: Clutter.Event) => {
        const button = event.get_button();

        // Right-click → open Adwaita preferences window
        if (button === 3) {
          this._extension.openPreferences();
          this.menu.close();
          return Clutter.EVENT_STOP;
        }

        // Left-click in drawer mode → intercept and toggle Wayland drawer instead
        if (button === 1 && this._settings.get_boolean("use-drawer")) {
          if ((this.menu as any).isOpen) this.menu.close();
          this._drawer.toggle();
          return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
      });

      // Close drawer when GNOME overview opens
      Main.overview.connect("showing", () => this._drawer.close());
    }

    // ─── Panel Construction ───────────────────────────────────────────────────

    private _buildPanel(): void {
      this._panelBox = new St.BoxLayout({ style_class: "todo-panel-box" });
      this._panelBox.add_child(new St.Icon({
        icon_name: "checkbox-checked-symbolic",
        style_class: "todo-panel-icon",
      }));
      this._panelLabel = new St.Label({
        text: "0",
        style_class: "todo-panel-count",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this._panelBox.add_child(this._panelLabel);
      this.add_child(this._panelBox);
    }

    private _updateVisibility(): void {
      if (this._settings.get_boolean("show-indicator")) {
        this.remove_style_class_name("todo-indicator-hidden");
        this._panelBox.show();
      } else {
        this.add_style_class_name("todo-indicator-hidden");
        this._panelBox.hide();
      }
    }

    // ─── Controller Actions ───────────────────────────────────────────────────

    private _addFromDrawer(): void {
      const text = this._drawer.entry.get_text().trim();
      if (this._service.add(text)) {
        this._drawer.entry.set_text("");
      }
    }

    private _refresh(): void {
      const { todos, completed } = this._service.snapshot();
      const activeCount = todos.filter(t => !completed.includes(t)).length;
      const completedCount = todos.length - activeCount;

      // Update local panel presentation
      this._panelLabel.set_text(String(activeCount));

      // Push state down to the UI managers
      this._todoMenu.refresh(activeCount, completedCount);
      this._drawer.updateCounts(activeCount, completedCount);
    }

    public toggleUI(): void {
      if (this._service.getUseDrawer()) {
        // Close the panel menu if it happens to be open
        if ((this.menu as any).isOpen) {
          this.menu.close();
        }
        this._drawer?.toggle();
      } else {
        // Close the drawer if it happens to be open
        this._drawer?.close();
        this.menu.toggle();
      }
    }

    // ─── Lifecycle / Cleanup ──────────────────────────────────────────────────

    override destroy(): void {
      // CLEANUP: Destroy dependencies to prevent cyclic GObject memory leaks
      if (this._todoMenu) {
        this._todoMenu.destroy();
      }
      if (this._settingsChangedId) {
        this._settings.disconnect(this._settingsChangedId);
        this._settingsChangedId = 0;
      }
      super.destroy();
    }
  }
);