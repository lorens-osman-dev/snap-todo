/**
 * ui/indicator.ts — Panel Button & Dropdown Menu
 *
 * Responsibility:
 *   - Render the top-bar button (icon + count label)
 *   - Build the dropdown menu (header, scrollable todo list, entry row)
 *   - Wire all user interactions to TodosService
 *   - Delegate data reads/writes exclusively to TodosService
 *
 * Does NOT:
 *   - Access GSettings directly for todo data (uses TodosService)
 *   - Manage the drawer widget (receives it via constructor)
 *
 * Lifecycle (called by extension.ts):
 *   const indicator = new LightTodoIndicator(settings, service, drawer, ext);
 *   Main.panel.addToStatusArea(uuid, indicator);
 *   // …
 *   indicator.destroy();  // always in disable()
 */

import GObject from "gi://GObject";
import St from "gi://St";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Clutter from "gi://Clutter";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import { TodosService } from "../services/todosService.js";
import { copyToClipboard } from "../services/clipboard.js";
import { TodoListRenderer } from "./todoList.js";
import { TodoDrawer } from "./drawer.js";
import { setupTooltip } from "../utils/tooltip.js";

// ─── Registration ─────────────────────────────────────────────────────────────

export const LightTodoIndicator = GObject.registerClass(
  class LightTodoIndicator extends PanelMenu.Button {

    // ─── Private State ────────────────────────────────────────────────────────

    private _settings: Gio.Settings;
    private _service: TodosService;
    private _drawer: TodoDrawer;
    private _extension: Extension;

    // Signal connection IDs — all disconnected in destroy()
    private _settingsChangedId: number = 0;
    private _themeChangedId: number = 0;

    // Desktop settings for tracking dark/light theme changes
    private _desktopSettings: Gio.Settings;

    // Menu actors (populated in _buildMenu)
    private _todoSection!: PopupMenu.PopupMenuSection;
    private _completedSubMenu!: PopupMenu.PopupSubMenuMenuItem;
    private _headerLabel!: St.Label;
    private _entry!: St.Entry;
    private _panelLabel!: St.Label;
    private _panelBox!: St.BoxLayout;

    // List renderer — owns item creation, signal wiring, and focus restoration
    private _renderer: TodoListRenderer;

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(
      settings: Gio.Settings,
      service: TodosService,
      drawer: TodoDrawer,
      extension: Extension,
    ) {
      super(0.0, "Light Todo", false);
      this._settings = settings;
      this._service = service;
      this._drawer = drawer;
      this._extension = extension;
      this._renderer = new TodoListRenderer(service, settings);

      this._buildPanel();
      this._buildMenu();
      this._refresh();

      // ── Drawer entry wiring ────────────────────────────────────────────────
      this._drawer.addBtn.connect("clicked", () => this._addFromDrawer());
      this._drawer.entry.clutter_text.connect("activate", () => this._addFromDrawer());

      // ── Visibility ────────────────────────────────────────────────────────
      this._updateVisibility();
      this._settings.connect("changed::show-indicator", () => this._updateVisibility());

      // ── Refresh on any settings change ────────────────────────────────────
      this._settingsChangedId = this._settings.connect("changed", () => this._refresh());

      // ── Input handling ────────────────────────────────────────────────────
      this.connect("button-press-event", (_actor: unknown, event: Clutter.Event) => {
        const button = event.get_button();

        // Right-click → open preferences
        if (button === 3) {
          this._extension.openPreferences();
          this.menu.close();
          return Clutter.EVENT_STOP;
        }

        // Left-click in drawer mode → toggle drawer instead of menu
        if (button === 1 && this._settings.get_boolean("use-drawer")) {
          if ((this.menu as any).isOpen) this.menu.close();
          this._drawer.toggle();
          return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
      });

      // ── Theme tracking ────────────────────────────────────────────────────
      this._desktopSettings = new Gio.Settings({
        schema_id: "org.gnome.desktop.interface",
      });
      this._updateThemeClass();
      this._themeChangedId = this._desktopSettings.connect(
        "changed::color-scheme",
        () => this._updateThemeClass(),
      );

      // Close drawer when the overview opens
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

    /**
     * Show/hide the panel icon+label without removing the indicator from the
     * panel (which would break position tracking).
     */
    private _updateVisibility(): void {
      if (this._settings.get_boolean("show-indicator")) {
        this.remove_style_class_name("todo-indicator-hidden");
        this._panelBox.show();
      } else {
        this.add_style_class_name("todo-indicator-hidden");
        this._panelBox.hide();
      }
    }

    // ─── Menu Construction ────────────────────────────────────────────────────

    private _buildMenu(): void {
      const menu = this.menu as PopupMenu.PopupMenu;

      // ── Header row (title + action buttons) ───────────────────────────────
      const headerItem = new PopupMenu.PopupBaseMenuItem({ activate: false, hover: false });

      this._headerLabel = new St.Label({
        text: "Todos",
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style: "font-weight: bold; color: #888888; font-size: 12px; margin-left: 6px;",
      });
      headerItem.add_child(this._headerLabel);

      // Copy active
      const copyActiveBtn = this._buildHeaderButton("edit-copy-symbolic");
      copyActiveBtn.connect("clicked", () => {
        copyToClipboard(this._service.getActiveTodos(), this._service.getCompletedTodos(), false);
        this.menu.close();
      });
      setupTooltip(copyActiveBtn, "Copy Uncompleted Todos");
      headerItem.add_child(copyActiveBtn);

      // Copy all
      const copyAllBtn = this._buildHeaderButton("edit-paste-symbolic");
      copyAllBtn.connect("clicked", () => {
        copyToClipboard(this._service.getActiveTodos(), this._service.getCompletedTodos(), true);
        this.menu.close();
      });
      setupTooltip(copyAllBtn, "Copy all Todos");
      headerItem.add_child(copyAllBtn);

      // Settings gear
      const settingsBtn = this._buildHeaderButton("emblem-system-symbolic");
      settingsBtn.accessible_name = "Open Preferences";
      settingsBtn.connect("clicked", () => {
        this._extension.openPreferences();
        this.menu.close();
      });
      setupTooltip(settingsBtn, "Settings");
      headerItem.add_child(settingsBtn);

      menu.addMenuItem(headerItem);

      // ── Scrollable active-todo section ────────────────────────────────────
      this._todoSection = new PopupMenu.PopupMenuSection();

      const activeScrollView = new St.ScrollView({
        style_class: "vfade",
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
        x_expand: true,
        y_expand: true,
      });
      activeScrollView.set_style("max-height: 350px;");
      activeScrollView.add_child(this._todoSection.actor);

      const scrollWrapper = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
        hover: false,
      });
      scrollWrapper.set_style("padding: 0; margin: 0;");
      scrollWrapper.add_child(activeScrollView);
      menu.addMenuItem(scrollWrapper);

      // ── Completed submenu ─────────────────────────────────────────────────
      this._completedSubMenu = new PopupMenu.PopupSubMenuMenuItem("Completed");
      menu.addMenuItem(this._completedSubMenu);

      menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      // ── Entry row ─────────────────────────────────────────────────────────
      this._buildEntryRow(menu);

      // Auto-focus entry when the menu opens
      (menu as any).connect("open-state-changed", (_m: unknown, open: unknown) => {
        if (open) {
          GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (this._entry?.is_mapped()) this._entry.grab_key_focus();
            return false;
          }, null);
        }
      });
    }

    /** Build a small icon button for the header row */
    private _buildHeaderButton(iconName: string): St.Button {
      const btn = new St.Button({
        style_class: "todo-header-btn",
        y_align: Clutter.ActorAlign.CENTER,
        can_focus: true,
      });
      btn.add_child(new St.Icon({ icon_name: iconName, style_class: "todo-header-icon" }));
      return btn;
    }

    /** Build the text-entry + add-button row at the bottom of the menu */
    private _buildEntryRow(menu: PopupMenu.PopupMenu): void {
      const entryItem = new PopupMenu.PopupBaseMenuItem({ activate: false });

      // When arrow-key navigation lands on this item, push focus to the entry
      entryItem.connect("notify::active", () => {
        if (!entryItem.active) return;
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
          if (this._entry?.is_mapped()) this._entry.grab_key_focus();
          return GLib.SOURCE_REMOVE;
        }, null);
      });

      this._entry = new St.Entry({
        style_class: "todo-entry",
        hint_text: "Add a todo…",
        x_expand: true,
        can_focus: true,
      });

      const addBtn = new St.Button({ style_class: "todo-add-btn todo-add-btn-disabled", label: "+" });

      let canAdd = false;
      let addTooltipText = "Type a todo...";

      addBtn.connect("clicked", () => {
        if (canAdd) this._addTodo(this._entry.get_text().trim());
      });
      setupTooltip(addBtn, () => addTooltipText);

      // Live validation: empty → disabled, duplicate → invalid, new → valid
      this._entry.clutter_text.connect("text-changed", () => {
        const text = this._entry.get_text().trim();
        const todos = this._service.getTodos();

        this._entry.remove_style_class_name("todo-entry-valid");
        this._entry.remove_style_class_name("todo-entry-invalid");

        if (!text) {
          canAdd = false;
          addBtn.add_style_class_name("todo-add-btn-disabled");
          addTooltipText = "Type a todo...";
          return;
        }

        if (todos.includes(text)) {
          canAdd = false;
          this._entry.add_style_class_name("todo-entry-invalid");
          addBtn.add_style_class_name("todo-add-btn-disabled");
          addTooltipText = "Todo already exists!";
        } else {
          canAdd = true;
          this._entry.add_style_class_name("todo-entry-valid");
          addBtn.remove_style_class_name("todo-add-btn-disabled");
          addTooltipText = "Add todo";
        }
      });

      this._entry.clutter_text.connect("activate", () =>
        this._addTodo(this._entry.get_text().trim()),
      );

      const entryBox = new St.BoxLayout({ x_expand: true });
      entryBox.add_child(this._entry);
      entryBox.add_child(addBtn);
      entryItem.add_child(entryBox);
      menu.addMenuItem(entryItem);
    }

    // ─── Data Operations (delegate to service) ────────────────────────────────

    private _addTodo(text: string): void {
      try {
        if (!this._service.add(text)) return;
        this._entry.set_text("");
        this._entry.remove_style_class_name("todo-entry-valid");
        this._entry.remove_style_class_name("todo-entry-invalid");
        // Reclaim focus after the list rebuilds
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
          if (this._entry?.is_mapped()) this._entry.grab_key_focus();
          return GLib.SOURCE_REMOVE;
        }, null);
      } catch (error) {
        import("../core/logger.js").then(({ Logger }) =>
          Logger.error("_addTodo()", error),
        );
      }
    }

    private _addFromDrawer(): void {
      const text = this._drawer.entry.get_text().trim();
      if (this._service.add(text)) {
        this._drawer.entry.set_text("");
      }
    }

    private _toggleTodo(text: string): void {
      // toggle() now computes and stores nextFocusText on the service
      this._service.toggle(text);
    }

    // ─── Refresh ──────────────────────────────────────────────────────────────

    /**
     * Rebuild the visible todo list and update the panel/menu counters.
     * Delegates all actor creation and signal wiring to TodoListRenderer.
     */
    private _refresh(): void {
      const { todos, completed } = this._service.snapshot();
      const showCompleted = this._service.getShowCompleted();
      const useDrawer = this._service.getUseDrawer();
      const activeCount = todos.filter(t => !completed.includes(t)).length;
      const completedCount = todos.length - activeCount;

      // Update panel button and menu header counts
      this._panelLabel.set_text(String(activeCount));
      this._headerLabel.set_text(`Todos (${activeCount})`);
      this._completedSubMenu.label.set_text(`Completed (${completedCount})`);

      // Delegate all item creation, routing, and focus restoration
      this._renderer.render(this._todoSection, this._completedSubMenu, this._drawer);

      // Show/hide the completed submenu based on current state
      this._completedSubMenu.visible = showCompleted && completedCount > 0 && !useDrawer;
    }

    // ─── Theme ────────────────────────────────────────────────────────────────

    private _updateThemeClass(): void {
      const menuActor = this.menu.actor as unknown as St.Widget;
      const colorScheme = this._desktopSettings.get_string("color-scheme");

      if (colorScheme === "prefer-dark") {
        menuActor.add_style_class_name("todo-dark-theme");
        menuActor.remove_style_class_name("todo-light-theme");
      } else {
        menuActor.add_style_class_name("todo-light-theme");
        menuActor.remove_style_class_name("todo-dark-theme");
      }
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    override destroy(): void {
      // Disconnect settings listeners to prevent memory leaks
      if (this._settingsChangedId) {
        this._settings.disconnect(this._settingsChangedId);
        this._settingsChangedId = 0;
      }
      if (this._themeChangedId) {
        this._desktopSettings.disconnect(this._themeChangedId);
        this._themeChangedId = 0;
      }
      super.destroy();
    }
  }
);