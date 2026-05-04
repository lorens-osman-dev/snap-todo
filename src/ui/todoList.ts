/**
 * ui/todoList.ts — List Renderer
 *
 * Responsibility:
 * - Turn the data arrays from TodosService into Clutter actors
 * - Wire TodoItem signals directly to the service
 * - Restore keyboard focus after every rebuild (consuming service focus-intent)
 * - Route items to the correct container (menu section, completed submenu, drawer)
 *
 * Does NOT:
 * - Know about the panel button or its label
 * - Manage the menu structure (headers, separators, entry row)
 * - Own any persistent actors — it only populates containers it receives
 *
 * Usage:
 * const renderer = new TodoListRenderer(service, settings);
 * renderer.render(todoSection, completedSubMenu, drawer);
 * // Call render() again whenever data changes.
 */

import GLib from "gi://GLib";
import Gio from "gi://Gio";
import St from "gi://St";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { TodoItem } from "./todoItem.js";
import { TodosService } from "../services/todosService.js";
import { TodoDrawer } from "./drawer.js";

// ─── Renderer ─────────────────────────────────────────────────────────────────

export class TodoListRenderer {

  private _service: TodosService;
  private _settings: Gio.Settings; // passed through to TodoItem for modifier reads

  constructor(service: TodosService, settings: Gio.Settings) {
    this._service = service;
    this._settings = settings;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Rebuild all three containers from the current service state.
   *
   * @param todoSection      - Active-todo PopupMenuSection in the dropdown menu
   * @param completedSubMenu - Completed PopupSubMenuMenuItem in the dropdown menu
   * @param drawer           - Slide-in drawer (or null if not yet created)
   */
  render(
    todoSection: PopupMenu.PopupMenuSection,
    completedSubMenu: PopupMenu.PopupSubMenuMenuItem,
    drawer: TodoDrawer | null,
  ): void {

    // ── 1. Clear ────────────────────────────────────────────────────────────
    todoSection.removeAll();
    completedSubMenu.menu.removeAll();
    if (drawer) {
      drawer.itemContainer.destroy_all_children();
      drawer.completedContainer.destroy_all_children();
      // Reset drawer focus-index tracking; stale indices from prior render must not persist.
      drawer.resetFocusState();
    }

    // ── 2. Fetch state snapshot ─────────────────────────────────────────────
    const { todos, completed, pinned } = this._service.snapshot();
    const showCompleted = this._service.getShowCompleted();
    const useDrawer = this._service.getUseDrawer();
    const activeCount = todos.filter(t => !completed.includes(t)).length;

    // ── 3. Empty states ─────────────────────────────────────────────────────
    if (activeCount === 0) {
      const msg = "No active todos yet ✨";

      if (useDrawer && drawer) {
        drawer.itemContainer.add_child(new St.Label({
          text: msg,
          style_class: "todo-empty-label",
          margin_top: 24,
        }));
      } else {
        todoSection.addMenuItem(
          new PopupMenu.PopupMenuItem(msg, {
            reactive: false,
            style_class: "todo-empty-label",
          }),
        );
      }
    }

    // ── 4. Build and route items ────────────────────────────────────────────
    const sorted = this._service.getSortedTodos();
    let itemToFocus: InstanceType<typeof TodoItem> | null = null;

    for (const text of sorted) {
      const isDone = completed.includes(text);
      const isPinned = pinned.includes(text);

      if (isDone && !showCompleted) continue;

      const item = new TodoItem(text, isDone, isPinned, this._settings);
      this._wireSignals(item);

      // Route to the correct container
      if (useDrawer && drawer) {
        if (isDone) {
          drawer.completedContainer.add_child(item);
        } else {
          drawer.itemContainer.add_child(item);
        }
      } else if (isDone) {
        completedSubMenu.menu.addMenuItem(item);
      } else {
        todoSection.addMenuItem(item);
      }

      // Track which item should receive focus after the rebuild
      if (text === this._service.nextFocusText) {
        itemToFocus = item;
      }
    }

    // Update Drawer Completed Header Visibility
    if (drawer) {
      const drawerCompletedCount = drawer.completedContainer.get_n_children();
      drawer.updateCompletedVisibility(drawerCompletedCount, showCompleted);
    }

    // ── 5. Restore focus ────────────────────────────────────────────────────
    if (itemToFocus) {
      const highlight = this._service.keepHighlight;

      // ─── Focus Restoration ───
      // Defer focus grab to the next main-loop iteration so Clutter's 
      // layout pipeline finishes allocating the newly built actors first.
      GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        if (itemToFocus) {
          itemToFocus.active = true;
          itemToFocus.grab_key_focus();

          if (highlight) {
            itemToFocus.add_style_class_name("todo-item-modifier-held");
          }

          // ─── Keyboard Focus Sync ───
          // Sync the drawer's internal focus state so Up/Down navigation 
          // works correctly after a reorder or toggle rebuilds the list.
          if (useDrawer && drawer) {
            drawer.syncFocusedItem(itemToFocus);
          }
        }

        // CLEANUP: Always remove idle sources to prevent memory leaks in the compositor
        return GLib.SOURCE_REMOVE;
      });

      // Consume the intent so subsequent refreshes don't re-apply it
      this._service.nextFocusText = null;
      this._service.keepHighlight = false;
    }


  }

  // ─── Signal Wiring ────────────────────────────────────────────────────────

  /**
   * Connect all TodoItem signals to the service.
   * The renderer owns this wiring so the indicator never needs to know about
   * individual item events.
   */
  private _wireSignals(item: InstanceType<typeof TodoItem>): void {
    item.connect("todo-toggle", (_i: unknown, t: string) =>
      this._service.toggle(t),
    );
    item.connect("todo-delete", (_i: unknown, t: string) =>
      this._service.delete(t),
    );
    item.connect("todo-edit", (_i: unknown, oldT: string, newT: string) =>
      this._service.rename(oldT, newT),
    );
    item.connect("todo-move", (_i: unknown, src: string, tgt: string) =>
      this._service.reorder(src, tgt),
    );
    item.connect("todo-move-step", (_i: unknown, src: string, dir: number, keepHi: boolean) =>
      // reorderStep now stores nextFocusText/keepHighlight internally
      this._service.reorderStep(src, dir, keepHi),
    );
    item.connect("todo-pin", (_i: unknown, t: string) =>
      this._service.togglePin(t),
    );
  }
}