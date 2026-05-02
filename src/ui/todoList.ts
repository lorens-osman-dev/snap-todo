/**
 * ui/todoList.ts
 *
 * Responsibility: List renderer. Turns data arrays from TodosService into Clutter actors.
 * It routes signals from the items directly to the service.
 */

import GLib from "gi://GLib";
import Gio from "gi://Gio";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { TodoItem } from "./todoItem.js";
import { TodosService } from "../services/todosService.js";
import { TodoDrawer } from "./drawer.js";
import St from "gi://St";

export class TodoListRenderer {
  private _service: TodosService;
  private _settings: Gio.Settings; // Needed to pass drag-modifier down to TodoItem

  constructor(service: TodosService, settings: Gio.Settings) {
    this._service = service;
    this._settings = settings;
  }

  public render(
    targetSection: PopupMenu.PopupMenuSection,
    completedSubMenu: PopupMenu.PopupSubMenuMenuItem,
    drawer: TodoDrawer | null
  ): void {
    // 1. Clear previous containers
    targetSection.removeAll();
    completedSubMenu.menu.removeAll();
    if (drawer && drawer.itemContainer) drawer.itemContainer.destroy_all_children();

    // 2. Fetch data
    const todos = this._service.getTodos();
    const completed = this._service.getCompleted();
    const pinned = this._service.getPinned();
    const showCompleted = this._service.getShowCompleted();
    const useDrawer = this._service.getUseDrawer();

    const activeCount = todos.filter(t => !completed.includes(t)).length;

    // 3. Handle Empty States
    if (activeCount === 0 && !useDrawer) {
      targetSection.addMenuItem(new PopupMenu.PopupMenuItem("No active todos yet ✨", { reactive: false, style_class: "todo-empty-label" }));
    } else if (activeCount === 0 && useDrawer && drawer) {
      drawer.itemContainer.add_child(new St.Label({ text: "No active todos yet ✨", style_class: "todo-empty-label", margin_top: 24 }));
    }

    // 4. Sort and Build 
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

      const item = new TodoItem(text, isDone, pinned.includes(text), this._settings);

      // ── Wire UI interactions to Data layer ──
      item.connect("todo-toggle", (_i, t) => this._service.toggleTodo(t));
      item.connect("todo-delete", (_i, t) => this._service.deleteTodo(t));
      item.connect("todo-edit", (_i, oldT, newT) => this._service.editTodo(oldT, newT));
      item.connect("todo-move", (_i, src, tgt) => this._service.moveTodo(src, tgt));
      item.connect("todo-move-step", (_i, src, dir, keepHi) => this._service.moveTodoStep(src, dir, keepHi));
      item.connect("todo-pin", (_i, t) => this._service.togglePin(t));

      // ── Routing ──
      if (useDrawer && drawer) {
        drawer.itemContainer.add_child(item);
      } else {
        if (isDone) completedSubMenu.menu.addMenuItem(item);
        else targetSection.addMenuItem(item);
      }

      if (text === this._service.nextFocusText) {
        itemToFocus = item;
      }
    }

    // ── Apply Focus Intent ──
    if (itemToFocus) {
      const highlight = this._service.keepHighlight;
      GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        if (itemToFocus) {
          itemToFocus.active = true;
          itemToFocus.grab_key_focus();
          if (highlight) itemToFocus.add_style_class_name("todo-item-modifier-held");
        }
        return GLib.SOURCE_REMOVE;
      }, null);

      this._service.nextFocusText = null;
      this._service.keepHighlight = false;
    }
  }
}