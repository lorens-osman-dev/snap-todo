/**
 * ui/menu.ts — Dropdown Menu Manager
 *
 * Responsibility:
 * - Build the dropdown menu (header, scrollable todo list, entry row)
 * - Delegate item rendering to TodoListRenderer
 * - Manage internal menu theme changes (Adwaita prefer-dark integration)
 *
 * Does NOT:
 * - Know about the panel button or its visibility
 * - Manage the slide-out drawer (except passing it to the renderer)
 */

import St from "gi://St";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Clutter from "gi://Clutter";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import { TodosService } from "../services/todosService.js";
import { copyToClipboard } from "../services/clipboard.js";
import { TodoListRenderer } from "./todoList.js";
import { TodoDrawer } from "./drawer.js";
import { setupTooltip } from "../utils/tooltip.js";

// ─── Menu Manager ─────────────────────────────────────────────────────────────

export class TodoMenu {

  // ─── Private State ────────────────────────────────────────────────────────

  private _menu: PopupMenu.PopupMenu;
  private _settings: Gio.Settings;
  private _service: TodosService;
  private _drawer: TodoDrawer;
  private _extension: Extension;
  private _renderer: TodoListRenderer;

  private _desktopSettings: Gio.Settings;
  private _themeChangedId: number = 0;
  private _openStateId: number = 0;

  // ─── Menu Actors ──────────────────────────────────────────────────────────

  private _headerLabel!: St.Label;
  private _todoSection!: PopupMenu.PopupMenuSection;
  private _completedSubMenu!: PopupMenu.PopupSubMenuMenuItem;
  private _entry!: St.Entry;

  // ─── Constructor ──────────────────────────────────────────────────────────

  constructor(
    menu: PopupMenu.PopupMenu,
    settings: Gio.Settings,
    service: TodosService,
    drawer: TodoDrawer,
    extension: Extension
  ) {
    this._menu = menu;
    this._settings = settings;
    this._service = service;
    this._drawer = drawer;
    this._extension = extension;
    this._renderer = new TodoListRenderer(service, settings);

    this._buildMenu();

    // ── Theme tracking (Adwaita System Preference) ───
    this._desktopSettings = new Gio.Settings({
      schema_id: "org.gnome.desktop.interface",
    });
    this._updateThemeClass();
    this._themeChangedId = this._desktopSettings.connect(
      "changed::color-scheme",
      () => this._updateThemeClass(),
    );
  }

  // ─── Construction ─────────────────────────────────────────────────────────

  private _buildMenu(): void {
    // ─── Header Row ───
    const headerItem = new PopupMenu.PopupBaseMenuItem({ activate: false, hover: false });

    this._headerLabel = new St.Label({
      text: "Todos",
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
      style: "font-weight: bold; font-size: 12px; ",
    });
    headerItem.add_child(this._headerLabel);

    // Copy active todos (Clipboard integration)
    const copyActiveBtn = this._buildHeaderButton("edit-copy-symbolic");
    copyActiveBtn.connect("clicked", () => {
      copyToClipboard(this._service.getActiveTodos(), this._service.getCompletedTodos(), false);
      this._menu.close();
    });
    setupTooltip(copyActiveBtn, "Copy Uncompleted Todos");
    headerItem.add_child(copyActiveBtn);

    // Copy all todos
    const copyAllBtn = this._buildHeaderButton("edit-paste-symbolic");
    copyAllBtn.connect("clicked", () => {
      copyToClipboard(this._service.getActiveTodos(), this._service.getCompletedTodos(), true);
      this._menu.close();
    });
    setupTooltip(copyAllBtn, "Copy all Todos");
    headerItem.add_child(copyAllBtn);

    // Settings gear
    const settingsBtn = this._buildHeaderButton("emblem-system-symbolic");
    settingsBtn.accessible_name = "Open Preferences";
    settingsBtn.connect("clicked", () => {
      this._extension.openPreferences();
      this._menu.close();
    });
    setupTooltip(settingsBtn, "Settings");
    headerItem.add_child(settingsBtn);

    this._menu.addMenuItem(headerItem);

    // ─── Scrollable Active List ───
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
    this._menu.addMenuItem(scrollWrapper);

    // ─── Completed Submenu ───
    this._completedSubMenu = new PopupMenu.PopupSubMenuMenuItem("Completed");
    this._completedSubMenu.label.set_style("font-weight: bold; font-size: 12px; ");

    this._menu.addMenuItem(this._completedSubMenu);

    this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    this._completedSubMenu.connect('key-focus-in', () => {
      this._completedSubMenu.add_style_class_name('focused-blue-border');
    });
    this._completedSubMenu.connect('key-focus-out', () => {
      this._completedSubMenu.remove_style_class_name('focused-blue-border');
    });

    // ─── Entry Row ───
    this._buildEntryRow(this._menu);

    // Auto-focus entry when the menu opens
    this._openStateId = (this._menu as any).connect("open-state-changed", (_m: unknown, open: boolean) => {
      if (open) {
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
          if (this._entry?.is_mapped()) this._entry.grab_key_focus();
          return GLib.SOURCE_REMOVE;
        });
      }
    });
  }

  private _buildHeaderButton(iconName: string): St.Button {
    const btn = new St.Button({
      style_class: "todo-header-btn",
      y_align: Clutter.ActorAlign.CENTER,
      can_focus: true,
    });
    btn.add_child(new St.Icon({ icon_name: iconName, style_class: "todo-header-icon" }));
    return btn;
  }

  private _buildEntryRow(menu: PopupMenu.PopupMenu): void {
    const entryItem = new PopupMenu.PopupBaseMenuItem({ activate: false });

    entryItem.connect("notify::active", () => {
      if (!entryItem.active) return;
      GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        if (this._entry?.is_mapped()) this._entry.grab_key_focus();
        return GLib.SOURCE_REMOVE;
      });
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

  // ─── Data Actions ─────────────────────────────────────────────────────────

  private _addTodo(text: string): void {
    try {
      if (!this._service.add(text)) return;
      this._entry.set_text("");
      this._entry.remove_style_class_name("todo-entry-valid");
      this._entry.remove_style_class_name("todo-entry-invalid");

      // Reclaim focus after the list rebuilds (Clutter layout queue resolution)
      GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        if (this._entry?.is_mapped()) this._entry.grab_key_focus();
        return GLib.SOURCE_REMOVE;
      });
    } catch (error) {
      import("../core/logger.js").then(({ Logger }) =>
        Logger.error("_addTodo()", error),
      );
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Called by the indicator when data updates. We synchronize the 
   * UI components directly associated with the PopupMenu here.
   */
  public refresh(activeCount: number, completedCount: number): void {
    this._headerLabel.set_text(`Todos (${activeCount})`);
    this._completedSubMenu.label.set_text(`Completed (${completedCount})`);

    const showCompleted = this._service.getShowCompleted();
    const useDrawer = this._service.getUseDrawer();

    // Delegate item creation to the abstract renderer
    this._renderer.render(this._todoSection, this._completedSubMenu, this._drawer);

    this._completedSubMenu.visible = showCompleted && completedCount > 0 && !useDrawer;
  }

  // ─── Theme Integration ────────────────────────────────────────────────────

  private _updateThemeClass(): void {
    const menuActor = this._menu.actor as unknown as St.Widget;
    const colorScheme = this._desktopSettings.get_string("color-scheme");

    if (colorScheme === "prefer-dark") {
      menuActor.add_style_class_name("todo-dark-theme");
      menuActor.remove_style_class_name("todo-light-theme");
    } else {
      menuActor.add_style_class_name("todo-light-theme");
      menuActor.remove_style_class_name("todo-dark-theme");
    }
  }

  // ─── Memory Safety ────────────────────────────────────────────────────────

  public destroy(): void {
    // CLEANUP: Ensure we prevent memory leaks by stripping external connections
    if (this._themeChangedId) {
      this._desktopSettings.disconnect(this._themeChangedId);
      this._themeChangedId = 0;
    }
    if (this._openStateId) {
      (this._menu as any).disconnect(this._openStateId);
      this._openStateId = 0;
    }
  }
}