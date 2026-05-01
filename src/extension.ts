/**
 * extension.ts — Light Todo GNOME Shell Extension
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

// ─── Todo Item Widget ────────────────────────────────────────────────────────

const TodoItem = GObject.registerClass(
  {
    Signals: {
      "todo-toggle": { param_types: [GObject.TYPE_STRING] },
      "todo-delete": { param_types: [GObject.TYPE_STRING] },
      "todo-edit": { param_types: [GObject.TYPE_STRING, GObject.TYPE_STRING] },
    },
  },
  class TodoItem extends PopupMenu.PopupBaseMenuItem {
    private _text: string;
    private _label: St.Label;
    private _entry: St.Entry;
    private _isEditing: boolean = false;

    constructor(text: string, completed: boolean = false) {
      super({ activate: false });
      this._text = text;

      const box = new St.BoxLayout({ style_class: "todo-item-box", x_expand: true });

      // 1. Check Button
      const checkBtn = new St.Button({
        style_class: completed ? "todo-check-btn todo-checked" : "todo-check-btn",
        x_align: Clutter.ActorAlign.START,
      });
      checkBtn.add_child(new St.Icon({
        icon_name: completed ? 'checkbox-checked-symbolic' : 'checkbox-symbolic',
        style_class: 'todo-check-icon'
      }));

      // 2. Main Label
      this._label = new St.Label({
        text,
        style_class: completed ? "todo-label todo-label-done" : "todo-label",
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
      });

      // 3. Hidden Edit Entry
      this._entry = new St.Entry({
        style_class: "todo-edit-entry",
        text: this._text,
        x_expand: true,
        visible: false,
        can_focus: true,
      });

      // 4. Edit Button
      const editBtn = new St.Button({
        style_class: "todo-edit-btn",
        x_align: Clutter.ActorAlign.END,
      });
      editBtn.add_child(new St.Icon({
        icon_name: "document-edit-symbolic",
        style_class: "todo-edit-icon"
      }));

      // 5. Delete Button
      const deleteBtn = new St.Button({
        style_class: "todo-delete-btn",
        label: "×",
        x_align: Clutter.ActorAlign.END,
      });

      box.add_child(checkBtn);
      box.add_child(this._label);
      box.add_child(this._entry);
      box.add_child(editBtn);
      box.add_child(deleteBtn);
      this.add_child(box);

      // Event Connections
      checkBtn.connect("clicked", () => this.emit("todo-toggle", this._text));
      deleteBtn.connect("clicked", () => this.emit("todo-delete", this._text));
      editBtn.connect("clicked", () => this._startEdit());

      // Wayland-safe Input Handling for the Entry
      this._entry.clutter_text.connect("activate", () => this._finishEdit());
      this._entry.clutter_text.connect("key-focus-out", () => {
        if (this._isEditing) this._finishEdit();
      });

      this._entry.clutter_text.connect("key-press-event", (_actor: unknown, event: Clutter.Event) => {
        if (event.get_key_symbol() === Clutter.KEY_Escape) {
          this._cancelEdit();
          return Clutter.EVENT_STOP; // Stop propagation so the popup menu doesn't close
        }
        return Clutter.EVENT_PROPAGATE;
      });
    }

    private _startEdit(): void {
      if (this._isEditing) return;
      this._isEditing = true;

      this._label.hide();
      this._entry.set_text(this._text);
      this._entry.show();

      // Defer focus grab to the next idle frame to ensure the actor is fully mapped
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
        // Revert to old text visually if they try to save an empty string
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

    getText(): string { return this._text; }
  }
);

// ─── Panel Indicator ─────────────────────────────────────────────────────────

const LightTodoIndicator = GObject.registerClass(
  class LightTodoIndicator extends PanelMenu.Button {
    private _settings: Gio.Settings;
    private _settingsChangedId: number = 0;
    private _todoSection!: PopupMenu.PopupMenuSection;
    private _entry!: St.Entry;
    private _panelLabel!: St.Label;

    constructor(settings: Gio.Settings) {
      super(0.0, "Light Todo", false);
      this._settings = settings;
      this._buildPanel();
      this._buildMenu();
      this._refresh();
      this._settingsChangedId = this._settings.connect("changed", () => this._refresh());
    }

    private _buildPanel(): void {
      const box = new St.BoxLayout({ style_class: "todo-panel-box" });
      box.add_child(new St.Icon({ icon_name: "checkbox-checked-symbolic", style_class: "todo-panel-icon" }));
      this._panelLabel = new St.Label({ text: "0", style_class: "todo-panel-count", y_align: Clutter.ActorAlign.CENTER });
      box.add_child(this._panelLabel);
      this.add_child(box);
    }

    private _buildMenu(): void {
      const menu = this.menu as PopupMenu.PopupMenu;

      menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem("Todos"));
      this._todoSection = new PopupMenu.PopupMenuSection();
      menu.addMenuItem(this._todoSection);
      menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      const entryItem = new PopupMenu.PopupBaseMenuItem({ activate: false });
      this._entry = new St.Entry({ style_class: "todo-entry", hint_text: "Add a todo…", x_expand: true, can_focus: true });
      this._entry.clutter_text.connect("activate", () => this._addTodo(this._entry.get_text().trim()));

      const addBtn = new St.Button({ style_class: "todo-add-btn", label: "+" });
      addBtn.connect("clicked", () => this._addTodo(this._entry.get_text().trim()));

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

    private _addTodo(text: string): void {
      if (!text) return;

      const todos = this._getTodos();

      if (todos.includes(text)) {
        // Log duplicate attempts for debugging
        log(`Attempted to add duplicate todo -> "${text}"`);
        return;
      }

      // Log successful additions
      log(`Successfully added todo -> "${text}"`);

      this._settings.set_strv("todos", [...todos, text]);
      this._entry.set_text("");
    }
    private _deleteTodo(text: string): void {
      this._settings.set_strv("todos", this._getTodos().filter(t => t !== text));
      this._settings.set_strv("completed", this._getCompleted().filter(t => t !== text));
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

      // Prevent duplicates
      if (todos.includes(newText) && oldText !== newText) {
        log(`Cannot rename to "${newText}": already exists.`);
        this._refresh(); // Force refresh to reset the UI item back to its old name
        return;
      }

      // Update in todos array
      const newTodos = todos.map(t => t === oldText ? newText : t);
      this._settings.set_strv("todos", newTodos);

      // Update in completed array (if it was completed)
      const completed = this._getCompleted();
      if (completed.includes(oldText)) {
        const newCompleted = completed.map(t => t === oldText ? newText : t);
        this._settings.set_strv("completed", newCompleted);
      }
    }

    private _refresh(): void {
      this._todoSection.removeAll();
      const todos = this._getTodos();
      const completed = this._getCompleted();
      const showCompleted = this._settings.get_boolean("show-completed");

      this._panelLabel.set_text(String(todos.filter(t => !completed.includes(t)).length));

      if (todos.length === 0) {
        this._todoSection.addMenuItem(new PopupMenu.PopupMenuItem("No todos yet  ✨", { reactive: false, style_class: "todo-empty-label" }));
        return;
      }

      for (const text of todos) {
        const isDone = completed.includes(text);
        if (isDone && !showCompleted) continue;
        const item = new TodoItem(text, isDone);

        // Connect the 3 signals
        item.connect("todo-toggle", (_i: unknown, t: string) => this._toggleTodo(t));
        item.connect("todo-delete", (_i: unknown, t: string) => this._deleteTodo(t));
        item.connect("todo-edit", (_i: unknown, oldT: string, newT: string) => this._editTodo(oldT, newT));

        this._todoSection.addMenuItem(item);
      }
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

  override enable(): void {
    this._indicator = new LightTodoIndicator(this.getSettings() as unknown as import("gi://Gio").default.Settings);
    Main.panel.addToStatusArea(this.uuid, this._indicator);
  }

  override disable(): void {
    this._indicator?.destroy();
    this._indicator = null;
  }
}

/**
 * A custom logger that automatically prepends the extension name.
 */
function log(message: string): void {
  console.log(`LightTodo: ${message}`);
}