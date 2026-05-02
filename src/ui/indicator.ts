/**
 * ui/indicator.ts
 *
 * Responsibility: Main panel button, top-bar menu layout, and overarching theme management.
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

import { Logger } from "../core/logger.js";
import { setupTooltip } from "../utils/tooltip.js";
import { TodosService } from "../services/todosService.js";
import { TodoDrawer } from "./drawer.js";
import { TodoListRenderer } from "./todoList.js";

export const LightTodoIndicator = GObject.registerClass(
  class LightTodoIndicator extends PanelMenu.Button {
    private _settings: Gio.Settings;
    private _service: TodosService;
    private _renderer: TodoListRenderer;
    private _drawer: TodoDrawer | null;

    private _settingsChangedId: number = 0;
    private _themeChangedId: number = 0;
    private _desktopSettings: Gio.Settings;

    private _todoSection!: PopupMenu.PopupMenuSection;
    private _completedSubMenu!: PopupMenu.PopupSubMenuMenuItem;
    private _panelBox!: St.BoxLayout;
    private _panelLabel!: St.Label;
    private _headerLabel!: St.Label;
    private _entry!: St.Entry;

    constructor(settings: Gio.Settings, extension: Extension) {
      super(0.0, "Light Todo", false);
      this._settings = settings;
      this._service = new TodosService(settings);
      this._renderer = new TodoListRenderer(this._service, this._settings);

      // Pass the service to the drawer so it can handle its own clipboard logic
      this._drawer = new TodoDrawer(this._service);

      this._buildPanel();
      this._buildMenu(extension);

      this._drawer.addBtn.connect("clicked", () => {
        if (this._service.addTodo(this._drawer!.entry.get_text().trim())) {
          this._drawer!.entry.set_text("");
        }
      });
      this._drawer.entry.clutter_text.connect("activate", () => {
        if (this._service.addTodo(this._drawer!.entry.get_text().trim())) {
          this._drawer!.entry.set_text("");
        }
      });

      this._updateVisibility();
      this._settings.connect("changed::show-indicator", () => this._updateVisibility());
      this._settingsChangedId = this._settings.connect("changed", () => this._refresh());

      // when press on indicator icon on topbar
      this.connect('button-press-event', (actor, event) => {
        const button = event.get_button();

        // Right-click: Open preferences
        if (button === 3) {
          extension.openPreferences();
          if ((this.menu as any).isOpen) this.menu.close();
          return Clutter.EVENT_STOP;
        }

        // Left-click: ONLY intercept if we are using the drawer
        if (button === 1 && this._service.getUseDrawer()) {
          if ((this.menu as any).isOpen) this.menu.close();
          this._drawer?.toggle();
          return Clutter.EVENT_STOP;
        }

        // Critical: Let GNOME natively handle everything else (including menu mode)
        return Clutter.EVENT_PROPAGATE;
      });

      this._desktopSettings = new Gio.Settings({ schema_id: "org.gnome.desktop.interface" });
      this._updateThemeClass();
      this._themeChangedId = this._desktopSettings.connect("changed::color-scheme", () => this._updateThemeClass());

      Main.overview.connect('showing', () => this._drawer?.close());
      this._refresh();
    }

    private _buildPanel(): void {
      this._panelBox = new St.BoxLayout({ style_class: "todo-panel-box" });
      this._panelBox.add_child(new St.Icon({ icon_name: "checkbox-checked-symbolic", style_class: "todo-panel-icon" }));
      this._panelLabel = new St.Label({ text: "0", style_class: "todo-panel-count", y_align: Clutter.ActorAlign.CENTER });
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

    // NEW: Wayland-native Clipboard implementation routed through TodosService
    private _copyToClipboard(all: boolean): void {
      const todos = this._service.getTodos();
      const completed = this._service.getCompleted();

      const activeTodos = todos.filter(t => !completed.includes(t));
      const completedTodos = todos.filter(t => completed.includes(t));

      let lines: string[] = [];

      if (!all) {
        if (activeTodos.length === 0) return;
        lines.push("# Todos:");
        activeTodos.forEach(t => lines.push(`- [ ] ${t}`));
      } else {
        if (todos.length === 0) return;

        if (activeTodos.length > 0) {
          lines.push("# Todos:");
          activeTodos.forEach(t => lines.push(`- [ ] ${t}`));
        }
        if (completedTodos.length > 0) {
          lines.push("# Completed Todos:");
          completedTodos.forEach(t => lines.push(`- [x] ${t}`));
        }
      }

      const text = lines.join("\n");
      St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);

      const count = all ? todos.length : activeTodos.length;
      Main.notify("Light Todo", `Copied ${count} item(s) to clipboard`);

      this.menu.close();
    }

    private _buildMenu(extension: Extension): void {
      const menu = this.menu as PopupMenu.PopupMenu;
      const headerItem = new PopupMenu.PopupBaseMenuItem({ activate: false, hover: false });

      this._headerLabel = new St.Label({ text: "Todos", x_expand: true, y_align: Clutter.ActorAlign.CENTER, style: "font-weight: bold; color: #888888; font-size: 12px; margin-left: 6px;" });

      const copyActiveBtn = new St.Button({ style_class: "todo-header-btn", y_align: Clutter.ActorAlign.CENTER });
      copyActiveBtn.add_child(new St.Icon({ icon_name: "edit-copy-symbolic", style_class: "todo-header-icon" }));
      copyActiveBtn.connect("clicked", () => this._copyToClipboard(false));

      const copyAllBtn = new St.Button({
        style_class: "todo-header-btn",
        y_align: Clutter.ActorAlign.CENTER,
        can_focus: true,
      });
      copyAllBtn.add_child(new St.Icon({
        icon_name: "edit-paste-symbolic",
        style_class: "todo-header-icon"
      }));
      copyAllBtn.connect("clicked", () => this._copyToClipboard(true));

      const settingsBtn = new St.Button({ style_class: "todo-header-btn", y_align: Clutter.ActorAlign.CENTER });
      settingsBtn.add_child(new St.Icon({ icon_name: "emblem-system-symbolic", style_class: "todo-header-icon" }));
      settingsBtn.connect("clicked", () => { extension.openPreferences(); this.menu.close(); });
      setupTooltip(settingsBtn, "Settings");

      headerItem.add_child(this._headerLabel);
      headerItem.add_child(copyActiveBtn);
      headerItem.add_child(copyAllBtn);
      headerItem.add_child(settingsBtn);
      menu.addMenuItem(headerItem);

      this._todoSection = new PopupMenu.PopupMenuSection();
      const activeScrollView = new St.ScrollView({ style_class: 'vfade', hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC, x_expand: true, y_expand: true });
      activeScrollView.set_style("max-height: 350px;");
      activeScrollView.add_child(this._todoSection.actor);

      const scrollWrapperItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false, hover: false });
      scrollWrapperItem.set_style("padding: 0; margin: 0;");
      scrollWrapperItem.add_child(activeScrollView);
      menu.addMenuItem(scrollWrapperItem);

      this._completedSubMenu = new PopupMenu.PopupSubMenuMenuItem("Completed");
      menu.addMenuItem(this._completedSubMenu);

      menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      const entryItem = new PopupMenu.PopupBaseMenuItem({ activate: false });

      entryItem.connect('notify::active', () => {
        if (entryItem.active) {
          GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (this._entry && this._entry.is_mapped()) this._entry.grab_key_focus();
            return GLib.SOURCE_REMOVE;
          }, null);
        }
      });

      this._entry = new St.Entry({ style_class: "todo-entry", hint_text: "Add a todo…", x_expand: true, can_focus: true });
      const addBtn = new St.Button({ style_class: "todo-add-btn todo-add-btn-disabled", label: "+" });

      let canAdd = false;
      let addTooltipText = "Type a todo...";
      setupTooltip(addBtn, () => addTooltipText);

      const tryAddTodo = () => {
        if (canAdd && this._service.addTodo(this._entry.get_text().trim())) {
          this._entry.set_text("");
          GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (this._entry && this._entry.is_mapped()) this._entry.grab_key_focus();
            return GLib.SOURCE_REMOVE;
          }, null);
        }
      };

      addBtn.connect("clicked", tryAddTodo);
      this._entry.clutter_text.connect("activate", tryAddTodo);

      this._entry.clutter_text.connect("text-changed", () => {
        const text = this._entry.get_text().trim();
        const todos = this._service.getTodos();

        this._entry.remove_style_class_name("todo-entry-valid");
        this._entry.remove_style_class_name("todo-entry-invalid");

        if (text.length === 0) {
          canAdd = false;
          addBtn.add_style_class_name("todo-add-btn-disabled");
          addTooltipText = "Type a todo...";
        } else if (todos.includes(text)) {
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

      const entryBox = new St.BoxLayout({ x_expand: true });
      entryBox.add_child(this._entry);
      entryBox.add_child(addBtn);
      entryItem.add_child(entryBox);
      menu.addMenuItem(entryItem);

      (menu as unknown as { connect(sig: string, cb: (...a: unknown[]) => void): number })
        .connect("open-state-changed", (_m: unknown, open: unknown) => {
          if (open) GLib.idle_add(GLib.PRIORITY_DEFAULT, () => { this._entry.grab_key_focus(); return false; }, null);
        });
    }

    private _refresh(): void {
      const todos = this._service.getTodos();
      const completed = this._service.getCompleted();
      const activeCount = todos.filter(t => !completed.includes(t)).length;
      const completedCount = todos.length - activeCount;

      this._panelLabel.set_text(String(activeCount));
      this._headerLabel.set_text(`Todos (${activeCount})`);
      this._completedSubMenu.label.set_text(`Completed (${completedCount})`);

      this._renderer.render(this._todoSection, this._completedSubMenu, this._drawer);
      this._completedSubMenu.visible = (this._service.getShowCompleted() && completedCount > 0 && !this._service.getUseDrawer());
    }

    private _updateThemeClass(): void {
      const colorScheme = this._desktopSettings.get_string("color-scheme");
      const menuActor = this.menu.actor as unknown as St.Widget;
      if (colorScheme === "prefer-dark") {
        menuActor.add_style_class_name("todo-dark-theme");
        menuActor.remove_style_class_name("todo-light-theme");
      } else {
        menuActor.add_style_class_name("todo-light-theme");
        menuActor.remove_style_class_name("todo-dark-theme");
      }
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

    override destroy(): void {
      if (this._drawer) {
        this._drawer.destroy();
        this._drawer = null;
      }
      if (this._settingsChangedId) this._settings.disconnect(this._settingsChangedId);
      if (this._themeChangedId) this._desktopSettings.disconnect(this._themeChangedId);
      super.destroy();
    }
  }
);