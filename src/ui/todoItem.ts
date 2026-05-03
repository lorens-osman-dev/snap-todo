/**
 * ui/todoItem.ts — Single Todo Row Widget
 *
 * Responsibility:
 *   - Render one todo as a PopupBaseMenuItem with check, edit, pin, delete, drag
 *   - Handle all user interactions for a single row
 *   - Emit typed signals upward; never mutate state directly
 *
 * Does NOT:
 *   - Access GSettings
 *   - Know about the list or indicator that contains it
 *
 * Signals emitted:
 *   "todo-toggle"    (text: string)
 *   "todo-delete"    (text: string)
 *   "todo-edit"      (oldText: string, newText: string)
 *   "todo-move"      (sourceText: string, targetText: string)  — DND drop
 *   "todo-move-step" (text: string, direction: int, keepHighlight: bool)
 *   "todo-pin"       (text: string)
 */
declare const global: any;
import GObject from "gi://GObject";
import St from "gi://St";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Clutter from "gi://Clutter";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as DND from "resource:///org/gnome/shell/ui/dnd.js";
import { setupTooltip } from "../utils/tooltip.js";

// ─── Registration ddddd─────────────────────────────────────────────────────────────

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
    // ─── Private State ────────────────────────────────────────────────────────

    private _text: string;
    private _label: St.Label;
    private _entry: St.Entry;
    private _isEditing: boolean = false;
    private _settings: Gio.Settings;

    // Reliable state for DND boundary enforcement
    private _isCompleted: boolean;
    private _isPinned: boolean;

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(
      text: string,
      completed: boolean,
      pinned: boolean,
      settings: Gio.Settings,
    ) {
      super({ activate: false });
      this._text = text;
      this._settings = settings;

      this._isCompleted = completed;
      this._isPinned = pinned;
      // ── Row container ──────────────────────────────────────────────────────
      const box = new St.BoxLayout({
        style_class: "todo-item-box",
        x_expand: true,
      });

      // ── Drag handle ────────────────────────────────────────────────────────
      const dragBtn = this._buildDragHandle();

      // ── Check button ───────────────────────────────────────────────────────
      const checkBtn = this._buildCheckButton(completed);

      // ── Label + inline edit entry ──────────────────────────────────────────
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

      // ── Action buttons ─────────────────────────────────────────────────────
      const pinBtn = this._buildPinButton(pinned);
      const editBtn = this._buildEditButton();
      const deleteBtn = this._buildDeleteButton(pinned);

      // ── Layout ─────────────────────────────────────────────────────────────
      box.add_child(dragBtn);
      box.add_child(checkBtn);
      box.add_child(this._label);
      box.add_child(this._entry);
      box.add_child(pinBtn);
      box.add_child(editBtn);
      box.add_child(deleteBtn);
      this.add_child(box);

      // ── Signal wiring ──────────────────────────────────────────────────────
      checkBtn.connect("clicked", () => this.emit("todo-toggle", this._text));
      deleteBtn.connect("clicked", () => this.emit("todo-delete", this._text));
      editBtn.connect("clicked", () => this._startEdit());
      pinBtn.connect("clicked", () => this.emit("todo-pin", this._text));

      // Commit edit when Enter is pressed or focus leaves the entry
      this._entry.clutter_text.connect("activate", () => this._finishEdit());
      this._entry.clutter_text.connect("key-focus-out", () => {
        if (this._isEditing) this._finishEdit();
      });

      // ── Keyboard shortcuts for the row ─────────────────────────────────────
      this._connectKeyboardEvents();

      // ── Scroll into view when focused ──────────────────────────────────────
      this.connect("notify::active", () => {
        if (this.active) this._scrollToItem();
        else this.remove_style_class_name("todo-item-modifier-held");
      });

      this.connect("key-focus-in", () => this._scrollToItem());
    }

    // ─── Button Builders ─────────────────────────────────────────────────────

    private _buildDragHandle(): St.Button {
      const btn = new St.Button({
        style_class: "todo-drag-btn",
        x_align: Clutter.ActorAlign.START,
        can_focus: false,
      });
      btn.add_child(new St.Icon({
        icon_name: "list-drag-handle-symbolic",
        style_class: "todo-drag-icon",
      }));

      // Wire GNOME DND; this row is both the draggable source and the drop target
      (btn as any)._delegate = this;
      (this as any)._delegate = this;
      DND.makeDraggable(btn, {});

      // Dynamic tooltip: shows current modifier key from settings
      setupTooltip(btn, () => {
        const mod = this._settings.get_string("drag-modifier");
        const modName = mod.charAt(0).toUpperCase() + mod.slice(1);
        return `Drag to reorder\n(${modName} + Up/Down)`;
      });

      return btn;
    }

    private _buildCheckButton(completed: boolean): St.Button {
      const btn = new St.Button({
        style_class: completed ? "todo-check-btn todo-checked" : "todo-check-btn",
        x_align: Clutter.ActorAlign.START,
      });
      btn.add_child(new St.Icon({
        icon_name: completed ? "checkbox-checked-symbolic" : "checkbox-symbolic",
        style_class: "todo-check-icon",
      }));
      setupTooltip(
        btn,
        completed
          ? "Make it incomplete / press Space Key"
          : "Mark this Todo as completed / press Space Key",
      );
      return btn;
    }

    private _buildEditButton(): St.Button {
      const btn = new St.Button({
        style_class: "todo-edit-btn",
        x_align: Clutter.ActorAlign.END,
      });
      btn.add_child(new St.Icon({
        icon_name: "document-edit-symbolic",
        style_class: "todo-edit-icon",
      }));
      setupTooltip(btn, "Edit this Todo");
      return btn;
    }

    private _buildDeleteButton(pinned: boolean): St.Button {
      const btn = new St.Button({
        style_class: "todo-delete-btn",
        label: "×",
        x_align: Clutter.ActorAlign.END,
        visible: !pinned, // pinned items cannot be deleted directly
      });
      setupTooltip(btn, "Delete this Todo");
      return btn;
    }

    private _buildPinButton(pinned: boolean): St.Button {
      const btn = new St.Button({
        style_class: pinned ? "todo-pin-btn todo-pinned" : "todo-pin-btn",
        x_align: Clutter.ActorAlign.END,
      });
      btn.add_child(new St.Icon({
        icon_name: pinned ? "starred-symbolic" : "non-starred-symbolic",
        style_class: "todo-pin-icon",
      }));
      setupTooltip(btn, "Pin this Todo to the top");
      return btn;
    }

    // ─── Inline Edit ─────────────────────────────────────────────────────────

    private _startEdit(): void {
      if (this._isEditing) return;
      this._isEditing = true;
      this._label.hide();
      this._entry.set_text(this._text);
      this._entry.show();

      // Defer focus grab so Clutter's layout pass completes first
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
        // Empty → revert; don't emit
        this._entry.set_text(this._text);
      }
    }

    // ─── Keyboard Events ─────────────────────────────────────────────────────

    /**
     * Connect keyboard handlers:
     *   Space       → toggle completed
     *   Delete      → delete todo
     *   Mod + Up/Down → reorder one step
     *   Mod key held → show yellow highlight
     */
    private _connectKeyboardEvents(): void {
      this.connect("key-press-event", (_actor: unknown, event: Clutter.Event) => {
        const state = event.get_state();
        const keyval = event.get_key_symbol();

        // Space → toggle
        if (keyval === Clutter.KEY_space) {
          this.emit("todo-toggle", this._text);
          return Clutter.EVENT_STOP;
        }

        // Delete → remove
        if (keyval === Clutter.KEY_Delete) {
          this.emit("todo-delete", this._text);
          return Clutter.EVENT_STOP;
        }

        // Resolve configured modifier
        const { mask, isModKey } = this._resolveModifier(keyval);
        const hasMod = (state & mask) !== 0 || isModKey;

        // Visual feedback while modifier is held
        if (hasMod) {
          this.add_style_class_name("todo-item-modifier-held");
        }

        // Modifier + arrow → reorder
        if ((state & mask) !== 0) {
          if (keyval === Clutter.KEY_Up) {
            this.emit("todo-move-step", this._text, -1, true);
            return Clutter.EVENT_STOP;
          }
          if (keyval === Clutter.KEY_Down) {
            this.emit("todo-move-step", this._text, 1, true);
            return Clutter.EVENT_STOP;
          }
        }

        return Clutter.EVENT_PROPAGATE;
      });

      this.connect("key-release-event", (_actor: unknown, event: Clutter.Event) => {
        const keyval = event.get_key_symbol();
        const { isModKey } = this._resolveModifier(keyval);
        if (isModKey) {
          this.remove_style_class_name("todo-item-modifier-held");
        }
        return Clutter.EVENT_PROPAGATE;
      });
    }

    /**
     * Resolve the Clutter modifier mask and modifier-key detection based on
     * the "drag-modifier" GSettings value ("alt" | "ctrl" | "shift").
     */
    private _resolveModifier(keyval: number): {
      mask: number;
      isModKey: boolean;
    } {
      const modStr = this._settings.get_string("drag-modifier");

      if (modStr === "ctrl") {
        return {
          mask: Clutter.ModifierType.CONTROL_MASK,
          isModKey: keyval === Clutter.KEY_Control_L || keyval === Clutter.KEY_Control_R,
        };
      }
      if (modStr === "shift") {
        return {
          mask: Clutter.ModifierType.SHIFT_MASK,
          isModKey: keyval === Clutter.KEY_Shift_L || keyval === Clutter.KEY_Shift_R,
        };
      }
      // Default: Alt
      return {
        mask: Clutter.ModifierType.MOD1_MASK,
        isModKey: keyval === Clutter.KEY_Alt_L || keyval === Clutter.KEY_Alt_R,
      };
    }

    // ─── Scroll Helper ────────────────────────────────────────────────────────

    /**
     * Ensure this row is visible inside its ancestor St.ScrollView.
     * Uses duck-typing to find the scroll view (avoids GJS instanceof quirks).
     */
    private _scrollToItem(): void {
      GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        if (!this.is_mapped()) return GLib.SOURCE_REMOVE;

        // Walk up the actor tree looking for a scroll view
        let parent = this.get_parent();
        let scrollView: any = null;
        while (parent) {
          if ("vscroll" in parent || typeof (parent as any).get_vscroll_bar === "function") {
            scrollView = parent;
            break;
          }
          parent = parent.get_parent();
        }

        if (scrollView?.vscroll?.adjustment) {
          const adj = scrollView.vscroll.adjustment;
          const [, itemY] = this.get_transformed_position();
          const [, svY] = scrollView.get_transformed_position();
          const relY = itemY - svY;
          const itemH = this.height;
          const visibleH = scrollView.height;

          if (relY < 0) {
            adj.value += relY;                    // scroll up
          } else if (relY + itemH > visibleH) {
            adj.value += relY + itemH - visibleH; // scroll down
          }
        }

        return GLib.SOURCE_REMOVE;
      }, null);
    }

    // ─── DND Delegate Methods ─────────────────────────────────────────────────
    // GNOME DND calls these on the _delegate, which is set to `this`.

    onDragBegin(): void {
      this.add_style_class_name("todo-item-modifier-held");

      // Lock the natural allocation so DND layout passes can't inflate this row
      const [, , natW, natH] = this.get_preferred_size();
      this.set_width(natW);
      this.set_height(natH);
    }

    onDragEnd(): void {
      // Release fixed size so the row can reflow normally after rebuild
      this.set_width(-1);
      this.set_height(-1);
      this._cleanupDragState();
    }

    onDragCancelled(): void {
      this.set_width(-1);
      this.set_height(-1);
      this._cleanupDragState();
    }

    private _cleanupDragState(): void {
      try { this.remove_style_class_name("todo-item-modifier-held"); } catch (_) { }
      try { this.remove_style_class_name("todo-drop-target"); } catch (_) { }

      try {
        const parent = this.get_parent();
        if (parent) {
          parent.get_children().forEach(child => {
            try {
              if (typeof (child as any).remove_style_class_name === "function") {
                (child as any).remove_style_class_name("todo-drop-target");
              }
            } catch (_) { }
          });
        }
      } catch (_) { }
    }

    getDragActor(): Clutter.Actor {
      // DND actors are injected into the global UI group, meaning they lose 
      // inherited CSS classes from the menu/drawer. We must explicitly re-apply them.
      const desktopSettings = new Gio.Settings({ schema_id: "org.gnome.desktop.interface" });
      const isDark = desktopSettings.get_string("color-scheme") === "prefer-dark";
      const themeClass = isDark ? "todo-dark-theme" : "todo-light-theme";

      const box = new St.BoxLayout({
        // Append the evaluated theme class directly to the clone
        style_class: `todo-item-box todo-drag-actor ${themeClass}`,
      });

      // Retain the drag handle icon for visual consistency
      box.add_child(new St.Icon({
        icon_name: "list-drag-handle-symbolic",
        style_class: "todo-drag-icon",
      }));

      // Clone the label state (including crossed-out completed styling)
      box.add_child(new St.Label({
        text: this._text,
        style_class: this._label.style_class,
        y_align: Clutter.ActorAlign.CENTER,
      }));

      return box;
    }

    getDragActorSource(): Clutter.Actor {
      return this;
    }
    // todoItem.ts

    handleDragOver(
      source: any,
      _actor: Clutter.Actor,
      _x: number,
      _y: number,
      _time: number,
    ): number {
      // Early rejections — always wipe our own highlight first
      if (!source || typeof source.getText !== "function" || source === this) {
        this.remove_style_class_name("todo-drop-target");
        return (DND as any).DragMotionResult?.NO_DROP ?? 0;
      }

      // 1. Clean up sibling highlights
      try {
        const parent = this.get_parent();
        if (parent) {
          parent.get_children().forEach(child => {
            if (child !== this) {
              try { (child as any).remove_style_class_name("todo-drop-target"); } catch (_) { }
            }
          });
        }
      } catch (_) { }

      // 2. STRICT BOUNDARY ENFORCEMENT
      if (
        typeof source.getIsPinned === "function" &&
        (source.getIsPinned() !== this.getIsPinned() || source.getIsCompleted() !== this.getIsCompleted())
      ) {
        // CRITICAL FIX: remove highlight before rejecting, otherwise it sticks
        this.remove_style_class_name("todo-drop-target");
        return (DND as any).DragMotionResult?.NO_DROP ?? 0;
      }

      // 3. Valid target — apply highlight
      this.add_style_class_name("todo-drop-target");
      return (DND as any).DragMotionResult?.MOVE_DROP ?? 2;
    }

    // Called automatically by Shell DND when the dragged cursor leaves this actor
    handleDragOut(): void {
      try { this.remove_style_class_name("todo-drop-target"); } catch (_) { }
    }

    acceptDrop(
      source: any,
      _actor: Clutter.Actor,
      _x: number,
      _y: number,
      _time: number,
    ): boolean {
      this._cleanupDragState();

      if (!source || typeof source.getText !== "function" || source === this) {
        return false;
      }

      // STRICT BOUNDARY ENFORCEMENT: Prevent array mutation
      if (
        typeof source.getIsPinned === "function" &&
        (source.getIsPinned() !== this.getIsPinned() || source.getIsCompleted() !== this.getIsCompleted())
      ) {
        return false;
      }

      this.emit("todo-move", source.getText(), this._text);
      return true;
    }

    // ─── Public Accessors ────────────────────────────────────────────────────

    getText(): string { return this._text; }
    getIsPinned(): boolean { return this._isPinned; }
    getIsCompleted(): boolean { return this._isCompleted; }
  }
);

// TypeScript type alias for external use
export type TodoItemType = InstanceType<typeof TodoItem>;