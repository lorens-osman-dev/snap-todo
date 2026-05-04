/**
 * ui/drawer.ts — Slide-in Drawer Surface
 *
 * Responsibility:
 * - Render a Wayland-native slide-in drawer for the todo list
 * - Manage open/close animations and the semi-transparent shield
 * - Expose `itemContainer`, `completedContainer`, `entry`, and `addBtn` for the indicator to wire
 * - Provide header action buttons (copy active, copy all, settings)
 *
 * Does NOT:
 * - Manage todo data (that belongs to TodosService)
 * - Know about the panel indicator
 *
 * Lifecycle:
 * const drawer = new TodoDrawer(service, extension);
 * drawer.open();
 * drawer.close();
 * drawer.destroy(); // always call in disable()
 *
 * ── Keyboard navigation design note ──────────────────────────────────────────
 *
 * TodoItem extends PopupBaseMenuItem. Calling grab_key_focus() on a
 * PopupBaseMenuItem moves Clutter key focus to an *internal* St.Bin — NOT the
 * TodoItem actor itself. Therefore global.stage.get_key_focus() never equals a
 * TodoItem reference, and any approach that reverse-engineers focused state by
 * querying the stage is permanently broken for this widget type.
 *
 * Solution: maintain our own _focusedIndex integer (which row is logically
 * active) and _entryFocused boolean. Navigation methods update these directly
 * instead of querying the stage.
 *
 * Up/Down from todo rows: PopupBaseMenuItem does NOT stop bare arrow keys, so
 * they naturally bubble up to _actor's key-press-event handler.
 * Up/Down from St.Entry: the entry's ClutterText swallows arrow keys before
 * they bubble, so we hook entry.clutter_text "key-press-event" separately.
 * Tab / Shift+Tab: intercepted via captured-event on _actor (capture fires
 * top-down before children, which is needed because Clutter handles Tab at
 * the toolkit level and it may not appear in key-press-event on children).
 */
declare const global: any;
import Gio from "gi://Gio";
import St from "gi://St";
import GLib from "gi://GLib";
import Clutter from "gi://Clutter";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import { TodosService } from "../services/todosService.js";
import { copyToClipboard } from "../services/clipboard.js";
import { setupTooltip } from "../utils/tooltip.js";
import { acquirePhantomHoverLock } from "./todoItem.js";

const DRAWER_WIDTH_PX = 600;

export class TodoDrawer {

  // ── Public surfaces (wired by the indicator / renderer) ──────────────────

  /** Container for active TodoItem widgets; rebuild its children on every refresh */
  public readonly itemContainer: St.BoxLayout;

  /** Container for completed TodoItem widgets */
  public readonly completedContainer: St.BoxLayout;

  /** Text input for adding new todos */
  public readonly entry: St.Entry;

  /** "+" button for confirming a new todo */
  public readonly addBtn: St.Button;

  // ── Private actors ────────────────────────────────────────────────────────

  private readonly _shield: St.Button;
  private readonly _actor: St.BoxLayout;
  private _isOpen = false;
  private readonly _service: TodosService;
  private readonly _extension: Extension;

  // ─── Collapsible Section Actors ───
  private readonly _completedWrapper: St.BoxLayout;
  private readonly _completedHeader: St.Button;

  // ─── Dynamic Header Labels ───
  private readonly _headerLabel: St.Label;
  private readonly _completedLabel: St.Label;

  /**
   * Index of the currently logically-focused todo row (into the flattened visible array).
   * -1 = focus is in the entry/addBtn zone.
   * Never derived from global.stage — always set by our own nav helpers.
   */
  private _focusedIndex = -1;

  /** True while the entry or addBtn holds keyboard focus. */
  private _entryFocused = true;

  /** Tracks the org.gnome.desktop.interface color-scheme GSettings signal ID. */
  private _themeChangedId = 0;

  /** GSettings handle for org.gnome.desktop.interface — needed for theme detection. */
  private _desktopSettings!: Gio.Settings;


  // ── Constructor ───────────────────────────────────────────────────────────

  constructor(service: TodosService, extension: Extension) {
    this._service = service;
    this._extension = extension;

    // Shield (full-screen backdrop)
    this._shield = new St.Button({
      style_class: "todo-drawer-shield",
      reactive: true,
      x_expand: true,
      y_expand: true,
      visible: false,
    });

    // Drawer panel.
    // can_focus:true lets _actor hold Clutter key focus when no child claims it.
    this._actor = new St.BoxLayout({
      vertical: true,
      style_class: "todo-drawer",
      reactive: true,
      can_focus: true,
      width: DRAWER_WIDTH_PX,
      visible: false,
    });

    // ─── Header Row ───
    const headerBox = new St.BoxLayout({ margin_bottom: 16, margin_top: 8, x_expand: true });
    this._headerLabel = new St.Label({
      text: "Todos",
      style_class: "todo-drawer-title",
      style: "font-weight: bold",
      y_align: Clutter.ActorAlign.CENTER,
      x_expand: true,
    });
    headerBox.add_child(this._headerLabel);

    const copyActiveBtn = this._buildHeaderButton("edit-copy-symbolic");
    copyActiveBtn.connect("clicked", () =>
      copyToClipboard(this._service.getActiveTodos(), this._service.getCompletedTodos(), false));
    setupTooltip(copyActiveBtn, "Copy Uncompleted Todos");
    headerBox.add_child(copyActiveBtn);

    const copyAllBtn = this._buildHeaderButton("edit-paste-symbolic");
    copyAllBtn.connect("clicked", () =>
      copyToClipboard(this._service.getActiveTodos(), this._service.getCompletedTodos(), true));
    setupTooltip(copyAllBtn, "Copy all Todos");
    headerBox.add_child(copyAllBtn);

    const settingsBtn = this._buildHeaderButton("emblem-system-symbolic");
    settingsBtn.accessible_name = "Open Preferences";
    settingsBtn.connect("clicked", () => { this._extension.openPreferences(); this.close(); });
    setupTooltip(settingsBtn, "Settings");
    headerBox.add_child(settingsBtn);

    this._actor.add_child(headerBox);

    // ─── Scrollable Lists ───
    const scrollView = new St.ScrollView({ x_expand: true, y_expand: true });

    // Container that holds both the active items and the completed collapsible section
    const listWrapper = new St.BoxLayout({ vertical: true, x_expand: true });
    this.itemContainer = new St.BoxLayout({ vertical: true, x_expand: true });
    listWrapper.add_child(this.itemContainer);

    // ─── Collapsible Completed Section ───
    this._completedWrapper = new St.BoxLayout({ vertical: true, x_expand: true, visible: false, margin_top: 12 });
    this.completedContainer = new St.BoxLayout({ vertical: true, x_expand: true, visible: false });


    const completedHeaderBox = new St.BoxLayout({
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
      style_class: "todo-completed-header-box"
    });

    this._completedLabel = new St.Label({
      text: "Completed",
      style: "font-weight: bold; margin-right:10px"
    });
    const spacer = new St.Widget({ x_expand: true });   // pushes following children to the right
    const completedIcon = new St.Icon({ icon_name: 'pan-end-symbolic', style_class: 'todo-header-icon' });

    completedHeaderBox.add_child(this._completedLabel)
    // completedHeaderBox.add_child(spacer);
    completedHeaderBox.add_child(completedIcon);

    this._completedHeader = new St.Button({
      style_class: "todo-drawer-completed-header",
      x_expand: true,
      can_focus: true,
      toggle_mode: true,
    });
    this._completedHeader.add_child(completedHeaderBox);
    // Explicitly handle programmatic focus highlights for Wayland
    this._completedHeader.connect('key-focus-in', () => {
      this._completedHeader.add_style_class_name('todo-drawer-completed-header-focused');
    });
    this._completedHeader.connect('key-focus-out', () => {
      this._completedHeader.remove_style_class_name('todo-drawer-completed-header-focused');
    });
    // Toggle visibility of the completed items container
    this._completedHeader.connect('clicked', () => {
      const isExpanded = this._completedHeader.checked;
      this.completedContainer.visible = isExpanded;
      completedIcon.icon_name = isExpanded ? 'pan-down-symbolic' : 'pan-end-symbolic';

      // Defer focus sync so Clutter's layout pass resolves the new visible children first
      GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        this._completedHeader.grab_key_focus();
        this.syncFocusedItem(this._completedHeader);
        return GLib.SOURCE_REMOVE;
      });
    });

    this._completedWrapper.add_child(this._completedHeader);
    this._completedWrapper.add_child(this.completedContainer);
    listWrapper.add_child(this._completedWrapper);

    scrollView.add_child(listWrapper);
    this._actor.add_child(scrollView);

    // ─── Entry Row ───
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

        // ─── Apply Focus Lock ───
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
          this.entry.grab_key_focus();
          acquirePhantomHoverLock(this.entry, 150);
          return GLib.SOURCE_REMOVE;
        });
      }
    });

    // When native focus lands on the entry or addBtn, sync our state.
    this.entry.clutter_text.connect("key-focus-in", () => {
      this._clearItemHighlights();
      this._focusedIndex = -1;
      this._entryFocused = true;
    });
    this.addBtn.connect("key-focus-in", () => {
      this._clearItemHighlights();
      this._focusedIndex = -1;
      this._entryFocused = true;
    });

    entryBox.add_child(this.entry);
    entryBox.add_child(this.addBtn);
    this._actor.add_child(entryBox);

    // Inject into the global UI layer
    Main.layoutManager.uiGroup.add_child(this._shield);
    Main.layoutManager.uiGroup.add_child(this._actor);

    this._updateGeometry();
    Main.layoutManager.connect("monitors-changed", () => this._updateGeometry());
    this._shield.connect("clicked", () => this.close());

    // ── Theme (light / dark) ──────────────────────────────────────────────────
    // Mirror the same approach used in menu.ts: read org.gnome.desktop.interface
    // color-scheme and toggle todo-dark-theme / todo-light-theme on _actor.
    // This must run AFTER _actor exists and has been added to the scene graph.
    this._desktopSettings = new Gio.Settings({ schema_id: "org.gnome.desktop.interface" });
    this._updateThemeClass();
    this._themeChangedId = this._desktopSettings.connect(
      "changed::color-scheme",
      () => this._updateThemeClass(),
    );

    // ── key-press-event on _actor ─────────────────────────────────────────
    // Fires when _actor holds focus OR when a child propagates a key event
    // upward without stopping it. PopupBaseMenuItem (TodoItem's base class)
    // propagates bare Up/Down arrows, so they reach here from focused rows.
    this._actor.connect("key-press-event", (_src: unknown, event: Clutter.Event) => {
      return this._onKeyPress(event);
    });

    // ── captured-event on _actor — Tab only ───────────────────────────────
    // Clutter handles Tab at the toolkit level; it often does NOT appear in
    // key-press-event on individual children. captured-event fires top-down
    // (parent before child) so we can intercept Tab here for all descendants.
    this._actor.connect("captured-event", (_src: unknown, event: Clutter.Event) => {
      if (event.type() !== Clutter.EventType.KEY_PRESS) return Clutter.EVENT_PROPAGATE;
      const kv = event.get_key_symbol();
      if (kv !== Clutter.KEY_Tab && kv !== Clutter.KEY_ISO_Left_Tab) return Clutter.EVENT_PROPAGATE;
      const shift = (event.get_state() & Clutter.ModifierType.SHIFT_MASK) !== 0;
      this._navigateTab(shift);
      return Clutter.EVENT_STOP;
    });

    // ── entry Up/Down ─────────────────────────────────────────────────────
    // St.Entry's ClutterText consumes Up/Down before they bubble to _actor.
    // Handle them here so the entry participates in Up/Down navigation.
    this.entry.clutter_text.connect("key-press-event", (_src: unknown, event: Clutter.Event) => {
      const kv = event.get_key_symbol();
      if (kv === Clutter.KEY_Up) {
        const items = this._getVisibleItems();
        if (items.length > 0) this._focusItem(items.length - 1);
        return Clutter.EVENT_STOP;
      }
      if (kv === Clutter.KEY_Down) {
        const items = this._getVisibleItems();
        if (items.length > 0) this._focusItem(0);
        return Clutter.EVENT_STOP;
      }
      return Clutter.EVENT_PROPAGATE;
    });
  }

  // ── Navigation helpers ────────────────────────────────────────────────────

  /**
     * Retrieves a flattened array of all dynamically visible items across
     * both active and completed containers, injecting the header in between.
     */
  private _getVisibleItems(): Clutter.Actor[] {
    const active = this.itemContainer.get_children();
    const items: Clutter.Actor[] = [...active];

    // Inject the header and completed items if the wrapper is visible
    if (this._completedWrapper.visible) {
      items.push(this._completedHeader);

      // Only inject the children if the collapsible section is currently open
      if (this.completedContainer.visible) {
        items.push(...this.completedContainer.get_children());
      }
    }

    return items;
  }

  /** Central Up/Down handler — called from _actor's key-press-event. */
  private _onKeyPress(event: Clutter.Event): boolean {
    const kv = event.get_key_symbol();
    const items = this._getVisibleItems();
    // exit when ESC 
    if (kv === Clutter.KEY_Escape) {
      this.close();
      return Clutter.EVENT_STOP;
    }

    if (kv === Clutter.KEY_Up) {
      if (items.length === 0) return Clutter.EVENT_PROPAGATE;
      if (this._entryFocused || this._focusedIndex <= 0) {
        // From entry zone, or already at top: jump to / stay at first item
        this._focusItem(this._entryFocused ? items.length - 1 : 0);
      } else {
        this._focusItem(this._focusedIndex - 1);
      }
      return Clutter.EVENT_STOP;
    }

    if (kv === Clutter.KEY_Down) {
      if (items.length === 0) return Clutter.EVENT_PROPAGATE;
      if (this._entryFocused || this._focusedIndex === -1) {
        this._focusItem(0);
      } else if (this._focusedIndex >= items.length - 1) {
        this._focusEntry();
      } else {
        this._focusItem(this._focusedIndex + 1);
      }
      return Clutter.EVENT_STOP;
    }

    return Clutter.EVENT_PROPAGATE;
  }

  /** Highlight and focus a todo row by dynamic index. */
  private _focusItem(index: number): void {
    const items = this._getVisibleItems();
    if (index < 0 || index >= items.length) return;
    this._clearItemHighlights();
    this._focusedIndex = index;
    this._entryFocused = false;
    const item = items[index] as any;
    item.grab_key_focus();
    if (item.active !== undefined) item.active = true;
  }

  /** Move focus to the text entry. */
  private _focusEntry(): void {
    this._clearItemHighlights();
    this._focusedIndex = -1;
    this._entryFocused = true;
    this.entry.grab_key_focus();
  }

  /**
   * Tab / Shift+Tab cycle:
   * item[0] → item[1] → … → item[n-1] → entry → addBtn → item[0]
   */
  private _navigateTab(backward: boolean): void {
    const items = this._getVisibleItems();
    const total = items.length + 2; // items + entry + addBtn

    // Determine current position in the chain
    let current: number;
    if (!this._entryFocused && this._focusedIndex >= 0) {
      current = this._focusedIndex;
    } else {
      // Distinguish entry (items.length) from addBtn (items.length + 1)
      const sf = global.stage.get_key_focus();
      const onAdd = sf === this.addBtn ||
        (typeof (this.addBtn as any).contains === "function" &&
          (this.addBtn as any).contains(sf));
      current = onAdd ? items.length + 1 : items.length;
    }

    const next = backward
      ? (current - 1 + total) % total
      : (current + 1) % total;

    if (next < items.length) {
      this._focusItem(next);
    } else if (next === items.length) {
      this._focusEntry();
    } else {
      this._clearItemHighlights();
      this._focusedIndex = -1;
      this._entryFocused = true;
      this.addBtn.grab_key_focus();
    }
  }

  /** Remove active/hover highlight from every todo row. */
  private _clearItemHighlights(): void {
    this._getVisibleItems().forEach(c => {
      if ((c as any).active !== undefined) (c as any).active = false;
    });
  }

  // ── Public API (called by Indicator & Renderer) ───────────────────────────────

  /**
   * Synchronize the dynamic header counts (active and completed) inside the drawer.
   */
  public updateCounts(activeCount: number, completedCount: number): void {
    this._headerLabel.set_text(`Todos (${activeCount})`);
    this._completedLabel.set_text(`Completed (${completedCount})`);
  }
  /**
   * Called to show/hide the entire completed section based on preferences and item counts.
   */
  public updateCompletedVisibility(count: number, showCompleted: boolean): void {
    this._completedWrapper.visible = showCompleted && count > 0;
  }

  /**
   * Reset our focus tracking after a full list rebuild.
   * Call this at the START of TodoListRenderer.render() before the renderer
   * applies service.nextFocusText, so stale indices don't persist.
   */
  public resetFocusState(): void {
    this._focusedIndex = -1;
    this._entryFocused = true;
  }

  /**
   * After the renderer restores focus to a specific item via service.nextFocusText,
   * call this so our index stays in sync. By passing the actual Actor reference,
   * the Drawer can resolve its position natively within the flattened visible list.
   */
  public syncFocusedItem(item: Clutter.Actor): void {
    const items = this._getVisibleItems();
    const idx = items.indexOf(item);
    if (idx !== -1) {
      this._focusedIndex = idx;
      this._entryFocused = false;
    }
  }

  // ── Theme ─────────────────────────────────────────────────────────────────

  private _updateThemeClass(): void {
    const scheme = this._desktopSettings.get_string("color-scheme");
    if (scheme === "prefer-dark") {
      this._actor.add_style_class_name("todo-dark-theme");
      this._actor.remove_style_class_name("todo-light-theme");
    } else {
      this._actor.add_style_class_name("todo-light-theme");
      this._actor.remove_style_class_name("todo-dark-theme");
    }
  }

  // ── Header button builder ─────────────────────────────────────────────────

  private _buildHeaderButton(iconName: string): St.Button {
    const btn = new St.Button({
      style_class: "todo-header-btn",
      y_align: Clutter.ActorAlign.CENTER,
      can_focus: true,
    });
    btn.add_child(new St.Icon({ icon_name: iconName, style_class: "todo-header-icon" }));
    return btn;
  }

  // ── Geometry ──────────────────────────────────────────────────────────────

  private _updateGeometry(): void {
    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor) return;
    this._shield.set_position(monitor.x, monitor.y);
    this._shield.set_size(monitor.width, monitor.height);
    this._actor.set_height(monitor.height);
    this._actor.set_position(monitor.x + monitor.width, monitor.y);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  toggle(): void { this._isOpen ? this.close() : this.open(); }

  open(): void {
    if (this._isOpen) return;
    this._isOpen = true;
    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor) return;

    this._shield.opacity = 0;
    this._shield.show();
    this._actor.show();

    (this._shield as any).ease({ opacity: 255, duration: 250, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
    (this._actor as any).ease({ x: monitor.x + monitor.width - DRAWER_WIDTH_PX, duration: 300, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });

    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      this.entry.grab_key_focus();

      // ─── Apply Focus Lock ───
      // Protect the entry from pointer-picking during the 300ms slide animation
      acquirePhantomHoverLock(this.entry, 350);

      this._entryFocused = true;
      this._focusedIndex = -1;
      return GLib.SOURCE_REMOVE;
    });
  }

  close(): void {
    if (!this._isOpen) return;
    this._isOpen = false;
    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor) return;

    (this._shield as any).ease({ opacity: 0, duration: 250, mode: Clutter.AnimationMode.EASE_IN_QUAD, onComplete: () => this._shield.hide() });
    (this._actor as any).ease({ x: monitor.x + monitor.width, duration: 300, mode: Clutter.AnimationMode.EASE_IN_CUBIC, onComplete: () => this._actor.hide() });
  }

  get isOpen(): boolean { return this._isOpen; }

  destroy(): void {
    // CLEANUP: Unbind desktop interface observer
    if (this._themeChangedId) {
      this._desktopSettings.disconnect(this._themeChangedId);
      this._themeChangedId = 0;
    }
    this._shield.destroy();
    this._actor.destroy();
  }
}