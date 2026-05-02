/**
 * ui/drawer.ts — Slide-in Drawer Surface
 *
 * Responsibility:
 *   - Render a Wayland-native slide-in drawer for the todo list
 *   - Manage open/close animations and the semi-transparent shield
 *   - Expose `itemContainer`, `entry`, and `addBtn` for the indicator to wire
 *   - Provide header action buttons (copy active, copy all, settings)
 *
 * Does NOT:
 *   - Manage todo data (that belongs to TodosService)
 *   - Know about the panel indicator
 *
 * Lifecycle:
 *   const drawer = new TodoDrawer(service, extension);
 *   // … wire signals to indicator …
 *   drawer.open();
 *   drawer.close();
 *   drawer.destroy(); // always call in disable()
 */

import St from "gi://St";
import GLib from "gi://GLib";
import Clutter from "gi://Clutter";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import { TodosService } from "../services/todosService.js";
import { copyToClipboard } from "../services/clipboard.js";
import { setupTooltip } from "../utils/tooltip.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const DRAWER_WIDTH_PX = 400;

// ─── Drawer Class ─────────────────────────────────────────────────────────────

export class TodoDrawer {

  // ─── Public Surfaces (wired by the indicator) ────────────────────────────

  /** Container for TodoItem widgets; rebuild its children on every refresh */
  public readonly itemContainer: St.BoxLayout;

  /** Text input for adding new todos */
  public readonly entry: St.Entry;

  /** "+" button for confirming a new todo */
  public readonly addBtn: St.Button;

  // ─── Private Actors ───────────────────────────────────────────────────────

  /** Full-screen semi-transparent overlay; clicking it closes the drawer */
  private readonly _shield: St.Button;

  /** The visible drawer panel actor */
  private readonly _actor: St.BoxLayout;

  private _isOpen: boolean = false;

  /** Service reference for header button actions */
  private readonly _service: TodosService;

  /** Extension reference for opening preferences */
  private readonly _extension: Extension;

  // ─── Constructor ──────────────────────────────────────────────────────────

  constructor(service: TodosService, extension: Extension) {
    this._service = service;
    this._extension = extension;

    // ── Shield (full-screen backdrop) ──────────────────────────────────────
    this._shield = new St.Button({
      style_class: "todo-drawer-shield",
      reactive: true,
      x_expand: true,
      y_expand: true,
      visible: false,
    });

    // ── Drawer panel ──────────────────────────────────────────────────────
    this._actor = new St.BoxLayout({
      vertical: true,
      style_class: "todo-drawer",
      reactive: true,
      width: DRAWER_WIDTH_PX,
      visible: false,
    });

    // ── Header with title + action buttons ────────────────────────────────
    const headerBox = new St.BoxLayout({
      margin_bottom: 16,
      margin_top: 8,
      x_expand: true,
    });

    const titleLabel = new St.Label({
      text: "My Todos",
      style: "font-weight: bold; font-size: 24px; color: #ffffff;",
      y_align: Clutter.ActorAlign.CENTER,
      x_expand: true,
    });
    headerBox.add_child(titleLabel);

    // Copy active todos button
    const copyActiveBtn = this._buildHeaderButton("edit-copy-symbolic");
    copyActiveBtn.connect("clicked", () => {
      copyToClipboard(this._service.getActiveTodos(), this._service.getCompletedTodos(), false);
    });
    setupTooltip(copyActiveBtn, "Copy Uncompleted Todos");
    headerBox.add_child(copyActiveBtn);

    // Copy all todos button
    const copyAllBtn = this._buildHeaderButton("edit-paste-symbolic");
    copyAllBtn.connect("clicked", () => {
      copyToClipboard(this._service.getActiveTodos(), this._service.getCompletedTodos(), true);
    });
    setupTooltip(copyAllBtn, "Copy all Todos");
    headerBox.add_child(copyAllBtn);

    // Settings gear button
    const settingsBtn = this._buildHeaderButton("emblem-system-symbolic");
    settingsBtn.accessible_name = "Open Preferences";
    settingsBtn.connect("clicked", () => {
      this._extension.openPreferences();
      this.close();
    });
    setupTooltip(settingsBtn, "Settings");
    headerBox.add_child(settingsBtn);

    this._actor.add_child(headerBox);

    // ── Scrollable list ────────────────────────────────────────────────────
    const scrollView = new St.ScrollView({ x_expand: true, y_expand: true });
    this.itemContainer = new St.BoxLayout({ vertical: true, x_expand: true });
    scrollView.add_child(this.itemContainer);
    this._actor.add_child(scrollView);

    // ── Entry row ──────────────────────────────────────────────────────────
    const entryBox = new St.BoxLayout({ x_expand: true, margin_top: 16 });
    this.entry = new St.Entry({
      style_class: "todo-entry",
      hint_text: "Add a todo…",
      x_expand: true,
      can_focus: true,
    });
    this.addBtn = new St.Button({
      style_class: "todo-add-btn todo-add-btn-disabled",
      label: "+",
      can_focus: true,
    });

    // Entry validation states (mirrors menu.ts behaviour)
    let canAdd = false;
    let addTooltipText = "Type a todo...";
    setupTooltip(this.addBtn, () => addTooltipText);

    this.entry.clutter_text.connect("text-changed", () => {
      const text = this.entry.get_text().trim();
      const todos = this._service.getTodos();

      this.entry.remove_style_class_name("todo-entry-valid");
      this.entry.remove_style_class_name("todo-entry-invalid");

      if (!text) {
        canAdd = false;
        this.addBtn.add_style_class_name("todo-add-btn-disabled");
        addTooltipText = "Type a todo...";
        return;
      }

      if (todos.includes(text)) {
        canAdd = false;
        this.entry.add_style_class_name("todo-entry-invalid");
        this.addBtn.add_style_class_name("todo-add-btn-disabled");
        addTooltipText = "Todo already exists!";
      } else {
        canAdd = true;
        this.entry.add_style_class_name("todo-entry-valid");
        this.addBtn.remove_style_class_name("todo-add-btn-disabled");
        addTooltipText = "Add todo";
      }
    });

    this.entry.clutter_text.connect("activate", () => {
      const text = this.entry.get_text().trim();
      if (canAdd && this._service.add(text)) {
        this.entry.set_text("");
        this.entry.remove_style_class_name("todo-entry-valid");
        this.entry.remove_style_class_name("todo-entry-invalid");
        this.addBtn.add_style_class_name("todo-add-btn-disabled");
        canAdd = false;
        addTooltipText = "Type a todo...";
      }
    });

    entryBox.add_child(this.entry);
    entryBox.add_child(this.addBtn);
    this._actor.add_child(entryBox);

    // ── Inject into the global UI layer ───────────────────────────────────
    Main.layoutManager.uiGroup.add_child(this._shield);
    Main.layoutManager.uiGroup.add_child(this._actor);

    // ── Geometry & signals ─────────────────────────────────────────────────
    this._updateGeometry();
    Main.layoutManager.connect("monitors-changed", () => this._updateGeometry());
    this._shield.connect("clicked", () => this.close());
  }

  // ─── Header Button Builder ────────────────────────────────────────────────

  private _buildHeaderButton(iconName: string): St.Button {
    const btn = new St.Button({
      style_class: "todo-header-btn",
      y_align: Clutter.ActorAlign.CENTER,
      can_focus: true,
    });
    btn.add_child(new St.Icon({
      icon_name: iconName,
      style_class: "todo-header-icon",
    }));
    return btn;
  }

  // ─── Geometry ─────────────────────────────────────────────────────────────

  private _updateGeometry(): void {
    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor) return;

    // Shield covers the whole primary monitor
    this._shield.set_position(monitor.x, monitor.y);
    this._shield.set_size(monitor.width, monitor.height);

    // Drawer starts just off the right edge
    this._actor.set_height(monitor.height);
    this._actor.set_position(monitor.x + monitor.width, monitor.y);
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  toggle(): void { this._isOpen ? this.close() : this.open(); }

  open(): void {
    if (this._isOpen) return;
    this._isOpen = true;

    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor) return;

    this._shield.opacity = 0;
    this._shield.show();
    this._actor.show();

    // Fade in the shield
    (this._shield as any).ease({
      opacity: 255,
      duration: 250,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });

    // Slide in the drawer panel from the right
    (this._actor as any).ease({
      x: monitor.x + monitor.width - DRAWER_WIDTH_PX,
      duration: 300,
      mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
    });

    // Auto-focus the entry field after the animation starts
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      this.entry.grab_key_focus();
      return GLib.SOURCE_REMOVE;
    }, null);
  }

  close(): void {
    if (!this._isOpen) return;
    this._isOpen = false;

    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor) return;

    // Fade out the shield
    (this._shield as any).ease({
      opacity: 0,
      duration: 250,
      mode: Clutter.AnimationMode.EASE_IN_QUAD,
      onComplete: () => this._shield.hide(),
    });

    // Slide the panel back off-screen
    (this._actor as any).ease({
      x: monitor.x + monitor.width,
      duration: 300,
      mode: Clutter.AnimationMode.EASE_IN_CUBIC,
      onComplete: () => this._actor.hide(),
    });
  }

  get isOpen(): boolean { return this._isOpen; }

  /** Must be called in the extension's disable() to prevent UI ghosts */
  destroy(): void {
    this._shield.destroy();
    this._actor.destroy();
  }
}