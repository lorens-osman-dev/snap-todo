/**
 * ui/drawer.ts — Slide-in Drawer Surface
 *
 * Responsibility:
 *   - Render a Wayland-native slide-in drawer for the todo list
 *   - Manage open/close animations and the semi-transparent shield
 *   - Expose `itemContainer`, `entry`, and `addBtn` for the indicator to wire
 *
 * Does NOT:
 *   - Manage todo data (that belongs to TodosService)
 *   - Know about the panel indicator
 *
 * Lifecycle:
 *   const drawer = new TodoDrawer();
 *   // … wire signals to indicator …
 *   drawer.open();
 *   drawer.close();
 *   drawer.destroy(); // always call in disable()
 */

import St from "gi://St";
import GLib from "gi://GLib";
import Clutter from "gi://Clutter";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

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

  // ─── Constructor ──────────────────────────────────────────────────────────

  constructor() {
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

    // ── Header ────────────────────────────────────────────────────────────
    const headerBox = new St.BoxLayout({ margin_bottom: 16, margin_top: 8 });
    headerBox.add_child(new St.Label({
      text: "My Todos",
      style: "font-weight: bold; font-size: 24px; color: #ffffff;",
      y_align: Clutter.ActorAlign.CENTER,
    }));
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
      style_class: "todo-add-btn",
      label: "+",
      can_focus: true,
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