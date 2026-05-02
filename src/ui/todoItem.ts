/**
 * ui/todoItem.ts
 *
 * Responsibility:
 * - Represents a single todo row in the popup menu or drawer.
 * - Handles internal UI state (editing mode, hover states, scrolling).
 * - Emits signals for user actions (toggle, delete, edit, move, pin).
 *
 * Does NOT:
 * - Manage global list state.
 * - Access or write to GSettings directly (only reads the drag modifier).
 */

import GObject from "gi://GObject";
import St from "gi://St";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Clutter from "gi://Clutter";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as DND from "resource:///org/gnome/shell/ui/dnd.js";

// Assume we extracted tooltip logic into a utils file
import { setupTooltip } from "../utils/tooltip.js";

// ─── Class Definition ────────────────────────────────────────────────────────

export const TodoItem = GObject.registerClass(
  {
    Signals: {
      "todo-toggle": { param_types: [GObject.TYPE_STRING] },
      "todo-delete": { param_types: [GObject.TYPE_STRING] },
      "todo-edit": { param_types: [GObject.TYPE_STRING, GObject.TYPE_STRING] },
      "todo-move": { param_types: [GObject.TYPE_STRING, GObject.TYPE_STRING] },
      "todo-move-step": { param_types: [GObject.TYPE_STRING, GObject.TYPE_INT, GObject.TYPE_BOOLEAN] },
      "todo-pin": { param_types: [GObject.TYPE_STRING] },
    },
  },
  class TodoItem extends PopupMenu.PopupBaseMenuItem {
    private _text: string;
    private _label: St.Label;
    private _entry: St.Entry;
    private _isEditing: boolean = false;
    private _settings: Gio.Settings; // Kept strictly for reading 'drag-modifier'

    // ─── Lifecycle & UI Construction ─────────────────────────────────────────

    constructor(text: string, completed: boolean, pinned: boolean, settings: Gio.Settings) {
      super({ activate: false });
      this._text = text;
      this._settings = settings;

      const box = new St.BoxLayout({ style_class: "todo-item-box", x_expand: true });

      // Drag Handle
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

      setupTooltip(dragBtn, () => {
        const mod = this._settings.get_string("drag-modifier");
        const modName = mod.charAt(0).toUpperCase() + mod.slice(1);
        return `Drag to reorder\n(${modName} + Up/Down)`;
      });

      // Checkbox Button
      const checkBtn = new St.Button({
        style_class: completed ? "todo-check-btn todo-checked" : "todo-check-btn",
        x_align: Clutter.ActorAlign.START,
      });
      checkBtn.add_child(new St.Icon({
        icon_name: completed ? 'checkbox-checked-symbolic' : 'checkbox-symbolic',
        style_class: 'todo-check-icon'
      }));

      setupTooltip(checkBtn, completed ? "Make it incomplete / press Space Key" : "Mark this Todo as completed / press Space Key");

      // Item Label
      this._label = new St.Label({
        text,
        style_class: completed ? "todo-label todo-label-done" : "todo-label",
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
      });

      // Inline Edit Entry
      this._entry = new St.Entry({
        style_class: "todo-edit-entry",
        text: this._text,
        x_expand: true,
        visible: false,
        can_focus: true,
      });

      // Edit Button
      const editBtn = new St.Button({
        style_class: "todo-edit-btn",
        x_align: Clutter.ActorAlign.END,
      });
      editBtn.add_child(new St.Icon({
        icon_name: "document-edit-symbolic",
        style_class: "todo-edit-icon"
      }));
      setupTooltip(editBtn, "Edit this Todo");

      // Delete Button
      const deleteBtn = new St.Button({
        style_class: "todo-delete-btn",
        label: "×",
        x_align: Clutter.ActorAlign.END,
        visible: !pinned,
      });
      setupTooltip(deleteBtn, "Delete this Todo");

      // Pin Button
      const pinBtn = new St.Button({
        style_class: pinned ? "todo-pin-btn todo-pinned" : "todo-pin-btn",
        x_align: Clutter.ActorAlign.END,
      });
      pinBtn.add_child(new St.Icon({
        icon_name: pinned ? "starred-symbolic" : "non-starred-symbolic",
        style_class: "todo-pin-icon"
      }));
      setupTooltip(pinBtn, "Pin this Todo to the top");

      // Assemble
      box.add_child(dragBtn);
      box.add_child(checkBtn);
      box.add_child(this._label);
      box.add_child(this._entry);
      box.add_child(pinBtn);
      box.add_child(editBtn);
      box.add_child(deleteBtn);
      this.add_child(box);

      // ─── Signal Wiring ─────────────────────────────────────────────────────

      checkBtn.connect("clicked", () => this.emit("todo-toggle", this._text));
      deleteBtn.connect("clicked", () => this.emit("todo-delete", this._text));
      editBtn.connect("clicked", () => this._startEdit());
      pinBtn.connect("clicked", () => this.emit("todo-pin", this._text));

      this._entry.clutter_text.connect("activate", () => this._finishEdit());
      this._entry.clutter_text.connect("key-focus-out", () => {
        if (this._isEditing) this._finishEdit();
      });

      this._setupKeyboardEvents();
    }

    // ─── Event Handlers ──────────────────────────────────────────────────────

    private _setupKeyboardEvents(): void {
      this.connect('key-press-event', (actor, event) => {
        const state = event.get_state();
        const keyval = event.get_key_symbol();

        if (keyval === Clutter.KEY_space) {
          this.emit("todo-toggle", this._text);
          return Clutter.EVENT_STOP;
        }

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
        if (this.active) {
          this._scrollToItem();
        } else {
          this.remove_style_class_name("todo-item-modifier-held");
        }
      });

      this.connect('key-focus-in', () => {
        this._scrollToItem();
      });
    }

    // ─── Internal Behaviours ─────────────────────────────────────────────────

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

    private _scrollToItem(): void {
      GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        if (!this.is_mapped()) return GLib.SOURCE_REMOVE;

        let parent = this.get_parent();
        let scrollView: any = null;

        while (parent) {
          if ('vscroll' in parent || typeof (parent as any).get_vscroll_bar === 'function') {
            scrollView = parent;
            break;
          }
          parent = parent.get_parent();
        }

        if (scrollView && scrollView.vscroll && scrollView.vscroll.adjustment) {
          const adj = scrollView.vscroll.adjustment;
          const [, itemY] = this.get_transformed_position();
          const [, svY] = scrollView.get_transformed_position();
          const relativeY = itemY - svY;
          const itemHeight = this.height;
          const visibleHeight = scrollView.height;

          if (relativeY < 0) {
            adj.value += relativeY;
          } else if (relativeY + itemHeight > visibleHeight) {
            adj.value += (relativeY + itemHeight - visibleHeight);
          }
        }
        return GLib.SOURCE_REMOVE;
      }, null);
    }

    // ─── DND Delegate Methods ────────────────────────────────────────────────

    onDragBegin(): void {
      this.add_style_class_name("todo-item-modifier-held");
    }

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

    getDragActorSource(): Clutter.Actor { return this; }

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