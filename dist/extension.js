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
const TodoItem = GObject.registerClass({
    Signals: {
        "todo-toggle": { param_types: [GObject.TYPE_STRING] },
        "todo-delete": { param_types: [GObject.TYPE_STRING] },
    },
}, class TodoItem extends PopupMenu.PopupBaseMenuItem {
    _text;
    constructor(text, completed = false) {
        super({ activate: false });
        this._text = text;
        const box = new St.BoxLayout({ style_class: "todo-item-box", x_expand: true });
        const checkBtn = new St.Button({
            style_class: completed ? "todo-check-btn todo-checked" : "todo-check-btn",
            label: completed ? "✓" : "○",
            x_align: Clutter.ActorAlign.START,
        });
        const label = new St.Label({
            text,
            style_class: completed ? "todo-label todo-label-done" : "todo-label",
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const deleteBtn = new St.Button({
            style_class: "todo-delete-btn",
            label: "×",
            x_align: Clutter.ActorAlign.END,
        });
        box.add_child(checkBtn);
        box.add_child(label);
        box.add_child(deleteBtn);
        this.add_child(box);
        checkBtn.connect("clicked", () => this.emit("todo-toggle", this._text));
        deleteBtn.connect("clicked", () => this.emit("todo-delete", this._text));
    }
    getText() { return this._text; }
});
// ─── Panel Indicator ─────────────────────────────────────────────────────────
const LightTodoIndicator = GObject.registerClass(class LightTodoIndicator extends PanelMenu.Button {
    _settings;
    _settingsChangedId = 0;
    _todoSection;
    _entry;
    _panelLabel;
    constructor(settings) {
        super(0.0, "Light Todo", false);
        this._settings = settings;
        this._buildPanel();
        this._buildMenu();
        this._refresh();
        this._settingsChangedId = this._settings.connect("changed", () => this._refresh());
    }
    _buildPanel() {
        const box = new St.BoxLayout({ style_class: "todo-panel-box" });
        box.add_child(new St.Icon({ icon_name: "checkbox-checked-symbolic", style_class: "todo-panel-icon" }));
        this._panelLabel = new St.Label({ text: "0", style_class: "todo-panel-count", y_align: Clutter.ActorAlign.CENTER });
        box.add_child(this._panelLabel);
        this.add_child(box);
    }
    _buildMenu() {
        const menu = this.menu;
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
        menu
            .connect("open-state-changed", (_m, open) => {
            if (open)
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => { this._entry.grab_key_focus(); return false; }, null);
        });
    }
    _getTodos() { return this._settings.get_strv("todos"); }
    _getCompleted() { return this._settings.get_strv("completed"); }
    _addTodo(text) {
        if (!text)
            return;
        const todos = this._getTodos();
        if (todos.includes(text)) {
            // Log duplicate attempts for debugging
            log(`LightTodo: Attempted to add duplicate todo -> "${text}"`);
            return;
        }
        // Log successful additions
        log(`LightTodo: Successfully added todo -> "${text}"`);
        this._settings.set_strv("todos", [...todos, text]);
        this._entry.set_text("");
    }
    _deleteTodo(text) {
        this._settings.set_strv("todos", this._getTodos().filter(t => t !== text));
        this._settings.set_strv("completed", this._getCompleted().filter(t => t !== text));
    }
    _toggleTodo(text) {
        const completed = this._getCompleted();
        if (completed.includes(text))
            this._settings.set_strv("completed", completed.filter(t => t !== text));
        else
            this._settings.set_strv("completed", [...completed, text]);
    }
    _refresh() {
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
            if (isDone && !showCompleted)
                continue;
            const item = new TodoItem(text, isDone);
            item.connect("todo-toggle", (_i, t) => this._toggleTodo(t));
            item.connect("todo-delete", (_i, t) => this._deleteTodo(t));
            this._todoSection.addMenuItem(item);
        }
    }
    destroy() {
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
        super.destroy();
    }
});
// ─── Extension Entry Point ───────────────────────────────────────────────────
export default class LightTodoExtension extends Extension {
    _indicator = null;
    enable() {
        this._indicator = new LightTodoIndicator(this.getSettings());
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }
    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
/**
 * A custom logger that automatically prepends the extension name.
 */
function log(message) {
    console.log(`LightTodo: ${message}`);
}
