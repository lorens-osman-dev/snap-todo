/**
 * extension.ts — Light Todo GNOME Shell Extension
 */
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import GObject from "gi://GObject";
import St from "gi://St";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Clutter from "gi://Clutter";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as DND from "resource:///org/gnome/shell/ui/dnd.js";

// ─── Todo Item Widget ────────────────────────────────────────────────────────

const TodoItem = GObject.registerClass(
  {
    Signals: {
      "todo-toggle": { param_types: [GObject.TYPE_STRING] },
      "todo-delete": { param_types: [GObject.TYPE_STRING] },
      "todo-edit": { param_types: [GObject.TYPE_STRING, GObject.TYPE_STRING] },
      "todo-move": { param_types: [GObject.TYPE_STRING, GObject.TYPE_STRING] },
      // NEW: Added a boolean parameter to track if the highlight should be kept after recreation
      "todo-move-step": { param_types: [GObject.TYPE_STRING, GObject.TYPE_INT, GObject.TYPE_BOOLEAN] },
      "todo-pin": { param_types: [GObject.TYPE_STRING] },
    },
  },
  class TodoItem extends PopupMenu.PopupBaseMenuItem {
    private _text: string;
    private _label: St.Label;
    private _entry: St.Entry;
    private _isEditing: boolean = false;
    private _settings: Gio.Settings;

    constructor(text: string, completed: boolean, pinned: boolean, settings: Gio.Settings) {
      super({ activate: false });
      this._text = text;
      this._settings = settings;

      const box = new St.BoxLayout({ style_class: "todo-item-box", x_expand: true });

      const dragBtn = new St.Button({
        style_class: "todo-drag-btn",
        x_align: Clutter.ActorAlign.START,
        can_focus: false,
      });
      dragBtn.add_child(new St.Icon({
        icon_name: "list-drag-handle-symbolic",
        style_class: "todo-drag-icon"
      }));

      // Bind GNOME Shell DND to the handle, but make the row the delegate
      (dragBtn as any)._delegate = this;
      (this as any)._delegate = this;
      DND.makeDraggable(dragBtn, {});

      const checkBtn = new St.Button({
        style_class: completed ? "todo-check-btn todo-checked" : "todo-check-btn",
        x_align: Clutter.ActorAlign.START,
      });
      checkBtn.add_child(new St.Icon({
        icon_name: completed ? 'checkbox-checked-symbolic' : 'checkbox-symbolic',
        style_class: 'todo-check-icon'
      }));

      this._label = new St.Label({
        text,
        style_class: completed ? "todo-label todo-label-done" : "todo-label",
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
      });

      this._entry = new St.Entry({
        style_class: "todo-edit-entry",
        text: this._text,
        x_expand: true,
        visible: false,
        can_focus: true,
      });

      const editBtn = new St.Button({
        style_class: "todo-edit-btn",
        x_align: Clutter.ActorAlign.END,
      });
      editBtn.add_child(new St.Icon({
        icon_name: "document-edit-symbolic",
        style_class: "todo-edit-icon"
      }));

      const deleteBtn = new St.Button({
        style_class: "todo-delete-btn",
        label: "×",
        x_align: Clutter.ActorAlign.END,
      });

      const pinBtn = new St.Button({
        style_class: pinned ? "todo-pin-btn todo-pinned" : "todo-pin-btn",
        x_align: Clutter.ActorAlign.END,
      });
      pinBtn.add_child(new St.Icon({
        icon_name: pinned ? "starred-symbolic" : "non-starred-symbolic",
        style_class: "todo-pin-icon"
      }));

      box.add_child(dragBtn);
      box.add_child(checkBtn);
      box.add_child(this._label);
      box.add_child(this._entry);
      box.add_child(pinBtn);
      box.add_child(editBtn);
      box.add_child(deleteBtn);
      this.add_child(box);

      checkBtn.connect("clicked", () => this.emit("todo-toggle", this._text));
      deleteBtn.connect("clicked", () => this.emit("todo-delete", this._text));
      editBtn.connect("clicked", () => this._startEdit());
      pinBtn.connect("clicked", () => this.emit("todo-pin", this._text));

      this._entry.clutter_text.connect("activate", () => this._finishEdit());
      this._entry.clutter_text.connect("key-focus-out", () => {
        if (this._isEditing) this._finishEdit();
      });

      // ─── Keyboard Dragging & Shortcuts Events ───────────────────────────────

      this.connect('key-press-event', (actor, event) => {
        const state = event.get_state();
        const keyval = event.get_key_symbol();

        // NEW: Handle Ctrl + Space -> Toggle completed state
        if (keyval === Clutter.KEY_space && (state & Clutter.ModifierType.CONTROL_MASK) !== 0) {
          this.emit("todo-toggle", this._text);
          return Clutter.EVENT_STOP;
        }

        // NEW: Handle Delete -> Remove todo
        if (keyval === Clutter.KEY_Delete) {
          this.emit("todo-delete", this._text);
          return Clutter.EVENT_STOP;
        }

        const modStr = this._settings.get_string("drag-modifier");

        let mask = Clutter.ModifierType.MOD1_MASK;
        let isModKey = (keyval === Clutter.KEY_Alt_L || keyval === Clutter.KEY_Alt_R);

        if (modStr === "ctrl") {
          mask = Clutter.ModifierType.CONTROL_MASK;
          isModKey = (keyval === Clutter.KEY_Control_L || keyval === Clutter.KEY_Control_R);
        } else if (modStr === "shift") {
          mask = Clutter.ModifierType.SHIFT_MASK;
          isModKey = (keyval === Clutter.KEY_Shift_L || keyval === Clutter.KEY_Shift_R);
        }

        const hasMod = (state & mask) !== 0 || isModKey;

        if (hasMod) {
          this.add_style_class_name("todo-item-modifier-held");
        }

        if ((state & mask) !== 0) {
          if (keyval === Clutter.KEY_Up) {
            this.emit("todo-move-step", this._text, -1, true);
            return Clutter.EVENT_STOP;
          } else if (keyval === Clutter.KEY_Down) {
            this.emit("todo-move-step", this._text, 1, true);
            return Clutter.EVENT_STOP;
          }
        }
        return Clutter.EVENT_PROPAGATE;
      });

      // ─── Keyboard Dragging Events ───────────────────────────────────────────

      this.connect('key-press-event', (actor, event) => {
        const state = event.get_state();
        const keyval = event.get_key_symbol();
        const modStr = this._settings.get_string("drag-modifier");

        let mask = Clutter.ModifierType.MOD1_MASK;
        let isModKey = (keyval === Clutter.KEY_Alt_L || keyval === Clutter.KEY_Alt_R);

        if (modStr === "ctrl") {
          mask = Clutter.ModifierType.CONTROL_MASK;
          isModKey = (keyval === Clutter.KEY_Control_L || keyval === Clutter.KEY_Control_R);
        } else if (modStr === "shift") {
          mask = Clutter.ModifierType.SHIFT_MASK;
          isModKey = (keyval === Clutter.KEY_Shift_L || keyval === Clutter.KEY_Shift_R);
        }

        const hasMod = (state & mask) !== 0 || isModKey;

        if (hasMod) {
          this.add_style_class_name("todo-item-modifier-held");
        }

        if ((state & mask) !== 0) {
          if (keyval === Clutter.KEY_Up) {
            // Pass true to tell the indicator to preserve the highlight during rebuild
            this.emit("todo-move-step", this._text, -1, true);
            return Clutter.EVENT_STOP;
          } else if (keyval === Clutter.KEY_Down) {
            this.emit("todo-move-step", this._text, 1, true);
            return Clutter.EVENT_STOP;
          }
        }
        return Clutter.EVENT_PROPAGATE;
      });

      this.connect('key-release-event', (actor, event) => {
        const keyval = event.get_key_symbol();
        const modStr = this._settings.get_string("drag-modifier");

        let isModKey = (keyval === Clutter.KEY_Alt_L || keyval === Clutter.KEY_Alt_R);
        if (modStr === "ctrl") isModKey = (keyval === Clutter.KEY_Control_L || keyval === Clutter.KEY_Control_R);
        else if (modStr === "shift") isModKey = (keyval === Clutter.KEY_Shift_L || keyval === Clutter.KEY_Shift_R);

        if (isModKey) {
          this.remove_style_class_name("todo-item-modifier-held");
        }
        return Clutter.EVENT_PROPAGATE;
      });

      this.connect('notify::active', () => {
        if (!this.active) {
          this.remove_style_class_name("todo-item-modifier-held");
        }
      });
    }

    private _startEdit(): void {
      if (this._isEditing) return;
      this._isEditing = true;

      this._label.hide();
      this._entry.set_text(this._text);
      this._entry.show();

      GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        this._entry.grab_key_focus();
        return GLib.SOURCE_REMOVE;
      }, null);
    }

    private _finishEdit(): void {
      if (!this._isEditing) return;
      this._isEditing = false;
      const newText = this._entry.get_text().trim();

      this._entry.hide();
      this._label.show();

      if (newText && newText !== this._text) {
        const oldText = this._text;
        this._text = newText;
        this._label.set_text(newText);
        this.emit("todo-edit", oldText, newText);
      } else if (!newText) {
        this._entry.set_text(this._text);
      }
    }

    private _cancelEdit(): void {
      if (!this._isEditing) return;
      this._isEditing = false;
      this._entry.hide();
      this._label.show();
      this._entry.set_text(this._text);
    }

    // ─── DND Delegate Methods ──────────────────────────────────────────────────

    // NEW: Trigger yellow highlight when mouse dragging starts
    onDragBegin(): void {
      this.add_style_class_name("todo-item-modifier-held");
    }

    // NEW: Remove highlight when dragging ends. Using try-catch because if a drop 
    // was accepted, settings are saved and this old actor is destroyed.
    onDragEnd(): void {
      try { this.remove_style_class_name("todo-item-modifier-held"); } catch (e) { }
    }

    onDragCancelled(): void {
      try { this.remove_style_class_name("todo-item-modifier-held"); } catch (e) { }
    }

    getDragActor(): Clutter.Actor {
      return new St.Label({
        text: this._text,
        style_class: "todo-label todo-drag-actor",
      });
    }

    getDragActorSource(): Clutter.Actor {
      return this;
    }

    handleDragOver(source: any, _actor: Clutter.Actor, _x: number, _y: number, _time: number): number {
      if (!source || typeof source.getText !== 'function' || source === this) {
        return (DND as any).DragMotionResult ? (DND as any).DragMotionResult.NO_DROP : 0;
      }
      return (DND as any).DragMotionResult ? (DND as any).DragMotionResult.MOVE_DROP : 2;
    }

    acceptDrop(source: any, _actor: Clutter.Actor, _x: number, _y: number, _time: number): boolean {
      if (!source || typeof source.getText !== 'function' || source === this) {
        return false;
      }
      this.emit("todo-move", source.getText(), this._text);
      return true;
    }

    getText(): string { return this._text; }
  }
);

// ─── Panel Indicator ─────────────────────────────────────────────────────────

const LightTodoIndicator = GObject.registerClass(
  class LightTodoIndicator extends PanelMenu.Button {
    private _settings: Gio.Settings;
    private _settingsChangedId: number = 0;
    private _todoSection!: PopupMenu.PopupMenuSection;
    private _completedSubMenu!: PopupMenu.PopupSubMenuMenuItem;
    private _headerItem!: PopupMenu.PopupBaseMenuItem;
    private _headerLabel!: St.Label;
    private _entry!: St.Entry;
    private _panelLabel!: St.Label;

    // NEW: Keep a reference to the inner box
    private _panelBox!: St.BoxLayout;

    private _textToFocus: string | null = null;
    private _keepHighlight: boolean = false; // NEW: Tracks highlight requirement across rebuilds

    constructor(settings: Gio.Settings, extension: Extension) {
      super(0.0, "Light Todo", false);
      this._settings = settings;

      // Set initial visibility and listen for changes
      this.visible = this._settings.get_boolean("show-indicator");
      this._settings.connect("changed::show-indicator", () => {
        this.visible = this._settings.get_boolean("show-indicator");
      });

      this._buildPanel();
      this._buildMenu();
      this._refresh();

      // NEW: Set initial visibility and listen for changes securely
      this._updateVisibility();
      this._settings.connect("changed::show-indicator", () => this._updateVisibility());

      this._settingsChangedId = this._settings.connect("changed", () => this._refresh());

      // Intercept Clutter pointer events for right-click handling
      this.connect('button-press-event', (actor, event) => {
        // 3 represents the secondary mouse button (Right-click)
        if (event.get_button() === 3) {
          // Launch the isolated GTK4/Adwaita preferences process
          extension.openPreferences();

          // Ensure the popup menu stays closed
          this.menu.close();

          // Stop propagation to prevent the shell from toggling the menu
          return Clutter.EVENT_STOP;
        }

        // Let standard left-clicks pass through to open the todo list
        return Clutter.EVENT_PROPAGATE;
      });
    }

    private _buildPanel(): void {
      // UPDATE: Assign the box to our class variable
      this._panelBox = new St.BoxLayout({ style_class: "todo-panel-box" });
      this._panelBox.add_child(new St.Icon({ icon_name: "checkbox-checked-symbolic", style_class: "todo-panel-icon" }));
      this._panelLabel = new St.Label({ text: "0", style_class: "todo-panel-count", y_align: Clutter.ActorAlign.CENTER });
      this._panelBox.add_child(this._panelLabel);
      this.add_child(this._panelBox);
    }

    // NEW: Safely collapses the indicator without destroying its anchor point
    private _updateVisibility(): void {
      const show = this._settings.get_boolean("show-indicator");
      if (show) {
        this.remove_style_class_name("todo-indicator-hidden");
        this._panelBox.show();
      } else {
        this.add_style_class_name("todo-indicator-hidden");
        this._panelBox.hide();
      }
    }

    private _buildMenu(): void {
      const menu = this.menu as PopupMenu.PopupMenu;

      this._headerItem = new PopupMenu.PopupBaseMenuItem({ activate: false, hover: false });

      this._headerLabel = new St.Label({
        text: "Todos",
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style: "font-weight: bold; color: #888888; font-size: 12px; margin-left: 6px;"
      });

      // Button: Copy Active
      const copyActiveBtn = new St.Button({
        style_class: "todo-header-btn",
        y_align: Clutter.ActorAlign.CENTER,
        can_focus: true,
      });
      copyActiveBtn.add_child(new St.Icon({ icon_name: "edit-copy-symbolic", style_class: "todo-header-icon" }));
      copyActiveBtn.connect("clicked", () => this._copyToClipboard(false));

      // Button: Copy All
      // Button: Copy All
      const copyAllBtn = new St.Button({
        style_class: "todo-header-btn",
        y_align: Clutter.ActorAlign.CENTER,
        can_focus: true,
      });

      // Changed icon_name to 'edit-paste-symbolic' which is universally available
      copyAllBtn.add_child(new St.Icon({
        icon_name: "edit-paste-symbolic",
        style_class: "todo-header-icon"
      }));

      copyAllBtn.connect("clicked", () => this._copyToClipboard(true));

      this._headerItem.add_child(this._headerLabel);
      this._headerItem.add_child(copyActiveBtn);
      this._headerItem.add_child(copyAllBtn);
      menu.addMenuItem(this._headerItem);

      this._todoSection = new PopupMenu.PopupMenuSection();
      menu.addMenuItem(this._todoSection);

      this._completedSubMenu = new PopupMenu.PopupSubMenuMenuItem("Completed");
      menu.addMenuItem(this._completedSubMenu);

      menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      const entryItem = new PopupMenu.PopupBaseMenuItem({ activate: false });
      this._entry = new St.Entry({ style_class: "todo-entry", hint_text: "Add a todo…", x_expand: true, can_focus: true });

      // CREATE BUTTON FIRST so it can be updated inside the listener
      const addBtn = new St.Button({ style_class: "todo-add-btn todo-add-btn-disabled", label: "+" });
      addBtn.reactive = false; // Disabled by default because input starts empty
      addBtn.connect("clicked", () => this._addTodo(this._entry.get_text().trim()));

      // Dynamic validation listener
      this._entry.clutter_text.connect("text-changed", () => {
        const text = this._entry.get_text().trim();
        const todos = this._getTodos();

        // Reset valid/invalid entry state on every keystroke
        this._entry.remove_style_class_name("todo-entry-valid");
        this._entry.remove_style_class_name("todo-entry-invalid");

        if (text.length === 0) {
          // Empty state: disable button
          addBtn.reactive = false;
          addBtn.add_style_class_name("todo-add-btn-disabled");
          return;
        }

        if (todos.includes(text)) {
          // Invalid state (duplicate): red input, disable button
          this._entry.add_style_class_name("todo-entry-invalid");
          addBtn.reactive = false;
          addBtn.add_style_class_name("todo-add-btn-disabled");
        } else {
          // Valid state: green input, enable button
          this._entry.add_style_class_name("todo-entry-valid");
          addBtn.reactive = true;
          addBtn.remove_style_class_name("todo-add-btn-disabled");
        }
      });

      this._entry.clutter_text.connect("activate", () => this._addTodo(this._entry.get_text().trim()));

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

    private _getTodos(): string[] { return this._settings.get_strv("todos"); }
    private _getCompleted(): string[] { return this._settings.get_strv("completed"); }
    private _getPinned(): string[] { return this._settings.get_strv("pinned"); }

    private _addTodo(text: string): void {
      if (!text) return;

      const todos = this._getTodos();
      if (todos.includes(text)) {
        log(`Attempted to add duplicate todo -> "${text}"`);
        return;
      }

      log(`Successfully added todo -> "${text}"`);

      // Updating settings triggers _refresh(), which rebuilds the UI
      this._settings.set_strv("todos", [...todos, text]);

      // Clear the text for the next item
      this._entry.set_text("");
      this._entry.remove_style_class_name("todo-entry-valid");
      this._entry.remove_style_class_name("todo-entry-invalid");

      // FIX: Yield to the main loop, wait for _refresh() to finish rebuilding 
      // the Clutter actors, and then forcefully reclaim keyboard focus.
      GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        if (this._entry && this._entry.is_mapped()) {
          this._entry.grab_key_focus();
        }
        return GLib.SOURCE_REMOVE;
      }, null);
    }

    private _deleteTodo(text: string): void {
      this._settings.set_strv("todos", this._getTodos().filter(t => t !== text));
      this._settings.set_strv("completed", this._getCompleted().filter(t => t !== text));
      this._settings.set_strv("pinned", this._getPinned().filter(t => t !== text));
    }

    private _toggleTodo(text: string): void {
      const completed = this._getCompleted();
      if (completed.includes(text))
        this._settings.set_strv("completed", completed.filter(t => t !== text));
      else
        this._settings.set_strv("completed", [...completed, text]);
    }

    private _editTodo(oldText: string, newText: string): void {
      const todos = this._getTodos();

      if (todos.includes(newText) && oldText !== newText) {
        log(`Cannot rename to "${newText}": already exists.`);
        this._refresh();
        return;
      }

      const pinned = this._getPinned();
      if (pinned.includes(oldText)) {
        const newPinned = pinned.map(t => t === oldText ? newText : t);
        this._settings.set_strv("pinned", newPinned);
      }

      const completed = this._getCompleted();
      if (completed.includes(oldText)) {
        const newCompleted = completed.map(t => t === oldText ? newText : t);
        this._settings.set_strv("completed", newCompleted);
      }
    }

    private _moveTodo(sourceText: string, targetText: string): void {
      const todos = this._getTodos();
      const sourceIndex = todos.indexOf(sourceText);
      const targetIndex = todos.indexOf(targetText);

      if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return;

      todos.splice(sourceIndex, 1);
      const newTargetIndex = todos.indexOf(targetText);
      todos.splice(newTargetIndex, 0, sourceText);

      log(`Moved "${sourceText}" to index ${newTargetIndex}`);
      this._settings.set_strv("todos", todos);
    }

    private _moveTodoStep(text: string, direction: number, keepHighlight: boolean): void {
      const todos = this._getTodos();
      const pinned = this._getPinned();
      const completed = this._getCompleted();
      const showCompleted = this._settings.get_boolean("show-completed");

      let visualTodos = [...todos].sort((a, b) => {
        const aPinned = pinned.includes(a);
        const bPinned = pinned.includes(b);
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;
        return 0;
      });

      if (!showCompleted) {
        visualTodos = visualTodos.filter(t => !completed.includes(t));
      }

      const index = visualTodos.indexOf(text);
      if (index === -1) return;

      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= visualTodos.length) return;

      const targetText = visualTodos[targetIndex];

      const mainTodos = [...todos];
      const idx1 = mainTodos.indexOf(text);
      const idx2 = mainTodos.indexOf(targetText);

      mainTodos[idx1] = targetText;
      mainTodos[idx2] = text;

      const isTargetPinned = pinned.includes(targetText);
      const isSourcePinned = pinned.includes(text);

      if (isTargetPinned !== isSourcePinned) {
        let newPinned = [...pinned];
        if (isTargetPinned) newPinned.push(text);
        else newPinned = newPinned.filter(p => p !== text);
        this._settings.set_strv("pinned", newPinned);
      }

      this._textToFocus = text;
      this._keepHighlight = keepHighlight; // Memorize highlight intent
      this._settings.set_strv("todos", mainTodos);
    }

    private _togglePin(text: string): void {
      const pinned = this._getPinned();
      if (pinned.includes(text)) {
        this._settings.set_strv("pinned", pinned.filter(t => t !== text));
      } else {
        this._settings.set_strv("pinned", [...pinned, text]);
      }
    }

    private _refresh(): void {
      // CLEANUP: Destroy old actors
      this._todoSection.removeAll();
      this._completedSubMenu.menu.removeAll();

      const todos = this._getTodos();
      const completed = this._getCompleted();
      const pinned = this._getPinned();
      const showCompleted = this._settings.get_boolean("show-completed");

      // Calculate counts
      const activeTodos = todos.filter(t => !completed.includes(t));
      const activeCount = activeTodos.length;
      const completedCount = todos.length - activeCount;

      // Update Panel indicator
      this._panelLabel.set_text(String(activeCount));

      // Update Menu UI Labels dynamically
      this._headerLabel.set_text(`Todos (${activeCount})`);
      this._completedSubMenu.label.set_text(`Completed (${completedCount})`);

      // Handle empty state for active tasks
      if (activeCount === 0) {
        this._todoSection.addMenuItem(new PopupMenu.PopupMenuItem("No active todos yet  ✨", { reactive: false, style_class: "todo-empty-label" }));
      }

      const sortedTodos = [...todos].sort((a, b) => {
        const aPinned = pinned.includes(a);
        const bPinned = pinned.includes(b);
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;
        return 0;
      });

      let itemToFocus: InstanceType<typeof TodoItem> | null = null;

      for (const text of sortedTodos) {
        const isDone = completed.includes(text);
        if (isDone && !showCompleted) continue;

        const isPinned = pinned.includes(text);
        const item = new TodoItem(text, isDone, isPinned, this._settings);

        item.connect("todo-toggle", (_i: unknown, t: string) => this._toggleTodo(t));
        item.connect("todo-delete", (_i: unknown, t: string) => this._deleteTodo(t));
        item.connect("todo-edit", (_i: unknown, oldT: string, newT: string) => this._editTodo(oldT, newT));
        item.connect("todo-move", (_i: unknown, src: string, tgt: string) => this._moveTodo(src, tgt));
        item.connect("todo-move-step", (_i: unknown, src: string, dir: number, keepHi: boolean) => this._moveTodoStep(src, dir, keepHi));
        item.connect("todo-pin", (_i: unknown, t: string) => this._togglePin(t));

        if (isDone) {
          this._completedSubMenu.menu.addMenuItem(item);
        } else {
          this._todoSection.addMenuItem(item);
        }

        if (text === this._textToFocus) {
          itemToFocus = item;
        }
      }

      // Automatically hide the collapsible section if it's empty or disabled
      this._completedSubMenu.visible = (showCompleted && completedCount > 0);

      // Restore focus and visual state
      if (itemToFocus) {
        const highlight = this._keepHighlight;
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
          if (itemToFocus) {
            itemToFocus.active = true;
            itemToFocus.grab_key_focus();
            if (highlight) {
              itemToFocus.add_style_class_name("todo-item-modifier-held");
            }
          }
          return GLib.SOURCE_REMOVE;
        }, null);

        this._textToFocus = null;
        this._keepHighlight = false;
      }
    }

    // NEW: Wayland-native Clipboard implementation
    private _copyToClipboard(all: boolean): void {
      const todos = this._getTodos();
      const completed = this._getCompleted();

      const activeTodos = todos.filter(t => !completed.includes(t));
      const completedTodos = todos.filter(t => completed.includes(t));

      let lines: string[] = [];

      if (!all) {
        // "Copy Active" clicked
        if (activeTodos.length === 0) return;

        lines.push("# Todos:");
        activeTodos.forEach(t => lines.push(`- [ ] ${t}`));
      } else {
        // "Copy All" clicked
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

      // Send to Wayland clipboard
      St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);

      // Trigger native GNOME notification
      const count = all ? todos.length : activeTodos.length;
      Main.notify("Light Todo", `Copied ${count} item(s) to clipboard`);

      // Close the menu so the user knows the action was completed
      this.menu.close();
    }

    override destroy(): void {
      if (this._settingsChangedId) { this._settings.disconnect(this._settingsChangedId); this._settingsChangedId = 0; }
      super.destroy();
    }
  }
);


// ─── Extension Entry Point ───────────────────────────────────────────────────

export default class LightTodoExtension extends Extension {
  private _indicator: InstanceType<typeof LightTodoIndicator> | null = null;
  private _settings: Gio.Settings | null = null;
  private _positionChangedId: number = 0; // NEW: Track position setting changes

  override enable(): void {
    this._settings = this.getSettings() as unknown as Gio.Settings;
    this._indicator = new LightTodoIndicator(this._settings, this);

    // Initial registration in the status area (makes it trackable)
    Main.panel.addToStatusArea(this.uuid, this._indicator);

    // NEW: Listen for position changes and apply immediately
    this._positionChangedId = this._settings.connect("changed::panel-position", () => this._updatePosition());
    this._updatePosition();

    // Register global Wayland-native shortcut (automatically updates when you change the setting!)
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
  }

  // NEW: Safely moves the Clutter actor to the requested panel sector
  private _updatePosition(): void {
    if (!this._indicator || !this._settings) return;

    const pos = this._settings.get_string("panel-position");

    // Remove from the current panel section
    const parent = this._indicator.get_parent();
    if (parent) {
      parent.remove_child(this._indicator);
    }

    // Bypass TypeScript's strictness for GNOME's internal panel boxes
    const panel = Main.panel as any;

    // Insert into the newly requested panel section
    if (pos === "left") {
      panel._leftBox.insert_child_at_index(this._indicator, panel._leftBox.get_n_children());
    } else if (pos === "center") {
      panel._centerBox.insert_child_at_index(this._indicator, panel._centerBox.get_n_children());
    } else {
      panel._rightBox.insert_child_at_index(this._indicator, 0);
    }
  }

  override disable(): void {
    // NEW: Always disconnect settings listeners to prevent memory leaks
    if (this._settings && this._positionChangedId) {
      this._settings.disconnect(this._positionChangedId);
      this._positionChangedId = 0;
    }

    Main.wm.removeKeybinding("toggle-shortcut");
    this._indicator?.destroy();
    this._indicator = null;
    this._settings = null;
  }
}

/**
 * A custom logger that automatically prepends the extension name.
 */
function log(message: string): void {
  console.log(`LightTodo: ${message}`);
}