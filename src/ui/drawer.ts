/**
 * ui/drawer.ts
 *
 * Responsibility: Manages the full-height side panel Wayland UI.
 */
/**
 * ui/drawer.ts
 */

import St from "gi://St";
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { setupTooltip } from "../utils/tooltip.js";
import { TodosService } from "../services/todosService.js";

export class TodoDrawer {
  public actor: St.BoxLayout;
  public itemContainer: St.BoxLayout;
  public entry: St.Entry;
  public addBtn: St.Button;

  private _shield: St.Button;
  private _isOpen: boolean = false;
  private _drawerWidth: number = 400;
  private _service: TodosService;

  constructor(service: TodosService) {
    this._service = service;

    this._shield = new St.Button({
      style_class: "todo-drawer-shield",
      reactive: true,
      x_expand: true,
      y_expand: true,
      visible: false,
    });

    this.actor = new St.BoxLayout({
      vertical: true,
      style_class: "todo-drawer",
      reactive: true,
      width: this._drawerWidth,
      visible: false,
    });

    // ── Drawer Header with Copy Buttons ──
    const headerBox = new St.BoxLayout({ margin_bottom: 16, margin_top: 8 });
    const headerLabel = new St.Label({
      text: "My Todos",
      style: "font-weight: bold; font-size: 24px; color: #ffffff;",
      y_align: Clutter.ActorAlign.CENTER,
      x_expand: true // Pushes the copy buttons to the far right
    });
    headerBox.add_child(headerLabel);

    const copyActiveBtn = new St.Button({ style_class: "todo-header-btn", y_align: Clutter.ActorAlign.CENTER });
    copyActiveBtn.add_child(new St.Icon({ icon_name: "edit-copy-symbolic", style_class: "todo-header-icon" }));
    copyActiveBtn.connect("clicked", () => this._copyToClipboard(false));
    setupTooltip(copyActiveBtn, "Copy Uncompleted Todos");

    const copyAllBtn = new St.Button({ style_class: "todo-header-btn", y_align: Clutter.ActorAlign.CENTER });
    copyAllBtn.add_child(new St.Icon({ icon_name: "edit-paste-symbolic", style_class: "todo-header-icon" }));
    copyAllBtn.connect("clicked", () => this._copyToClipboard(true));
    setupTooltip(copyAllBtn, "Copy all Todos");

    headerBox.add_child(copyActiveBtn);
    headerBox.add_child(copyAllBtn);

    this.actor.add_child(headerBox);

    const scrollView = new St.ScrollView({
      x_expand: true,
      y_expand: true,
    });
    this.itemContainer = new St.BoxLayout({ vertical: true, x_expand: true });
    scrollView.add_child(this.itemContainer);
    this.actor.add_child(scrollView);

    const entryBox = new St.BoxLayout({ x_expand: true, margin_top: 16 });
    this.entry = new St.Entry({
      style_class: "todo-entry",
      hint_text: "Add a todo…",
      x_expand: true,
      can_focus: true
    });
    this.addBtn = new St.Button({
      style_class: "todo-add-btn",
      label: "+",
      can_focus: true
    });
    entryBox.add_child(this.entry);
    entryBox.add_child(this.addBtn);
    this.actor.add_child(entryBox);

    Main.layoutManager.uiGroup.add_child(this._shield);
    Main.layoutManager.uiGroup.add_child(this.actor);

    this._updateGeometry();
    Main.layoutManager.connect("monitors-changed", () => this._updateGeometry());
    this._shield.connect("clicked", () => this.close());
  }

  // Same Wayland clipboard implementation decoupled via TodosService
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

    this.close(); // Automatically dismiss the drawer after a successful copy
  }

  private _updateGeometry(): void {
    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor) return;
    this._shield.set_position(monitor.x, monitor.y);
    this._shield.set_size(monitor.width, monitor.height);
    this.actor.set_height(monitor.height);
    this.actor.set_position(monitor.x + monitor.width, monitor.y);
  }

  public toggle(): void { this._isOpen ? this.close() : this.open(); }

  public open(): void {
    if (this._isOpen) return;
    this._isOpen = true;
    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor) return;

    this._shield.show();
    this.actor.show();

    this._shield.opacity = 0;
    (this._shield as any).ease({ opacity: 255, duration: 250, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
    (this.actor as any).ease({ x: monitor.x + monitor.width - this._drawerWidth, duration: 300, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });

    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      this.entry.grab_key_focus();
      return GLib.SOURCE_REMOVE;
    }, null);
  }

  public close(): void {
    if (!this._isOpen) return;
    this._isOpen = false;
    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor) return;

    (this._shield as any).ease({ opacity: 0, duration: 250, mode: Clutter.AnimationMode.EASE_IN_QUAD, onComplete: () => this._shield.hide() });
    (this.actor as any).ease({ x: monitor.x + monitor.width, duration: 300, mode: Clutter.AnimationMode.EASE_IN_CUBIC, onComplete: () => this.actor.hide() });
  }

  public destroy(): void {
    this._shield.destroy();
    this.actor.destroy();
  }
}