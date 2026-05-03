/**
 * services/todosService.ts — Data Layer
 *
 * Responsibility:
 *   - Single source of truth for reading/writing todos, completed, pinned
 *   - All GSettings access is centralised here
 *   - Provides typed methods instead of raw strv calls scattered across UI code
 *
 * Does NOT:
 *   - Touch any Clutter/St/UI code
 *   - Emit GObject signals (that's the UI layer's job)
 *
 * Usage:
 *   const svc = new TodosService(settings);
 *   svc.add("Buy milk");
 *   svc.toggle("Buy milk");
 *   svc.reorderStep("Buy milk", -1);
 */

import Gio from "gi://Gio";
import { Logger } from "../core/logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TodoSnapshot {
  todos: string[];
  completed: string[];
  pinned: string[];
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class TodosService {
  private _settings: Gio.Settings;

  /**
   * The text of the item that should receive keyboard focus after the next
   * list rebuild.  Set by toggle() / reorderStep(); consumed and cleared by
   * TodoListRenderer after each render().
   */
  public nextFocusText: string | null = null;

  /**
   * Whether the focused item should also receive the yellow "modifier held"
   * highlight after the next rebuild (used during keyboard reordering).
   */
  public keepHighlight: boolean = false;

  constructor(settings: Gio.Settings) {
    this._settings = settings;
  }

  // ─── UI Preference Reads ─────────────────────────────────────────────────
  // Centralised here so TodoListRenderer never touches _settings directly.

  getShowCompleted(): boolean { return this._settings.get_boolean("show-completed"); }
  getUseDrawer(): boolean { return this._settings.get_boolean("use-drawer"); }

  // ─── Primitive Reads ────────────────────────────────────────────────────────

  getTodos(): string[] { return this._settings.get_strv("todos"); }
  getCompleted(): string[] { return this._settings.get_strv("completed"); }
  getPinned(): string[] { return this._settings.get_strv("pinned"); }

  /** Convenience snapshot — call once per operation to avoid multiple reads */
  snapshot(): TodoSnapshot {
    return {
      todos: this.getTodos(),
      completed: this.getCompleted(),
      pinned: this.getPinned(),
    };
  }

  // ─── Derived Reads ──────────────────────────────────────────────────────────

  getActiveTodos(): string[] {
    const { todos, completed } = this.snapshot();
    return todos.filter(t => !completed.includes(t));
  }

  getCompletedTodos(): string[] {
    const { todos, completed } = this.snapshot();
    return todos.filter(t => completed.includes(t));
  }

  isCompleted(text: string): boolean {
    return this.getCompleted().includes(text);
  }

  isPinned(text: string): boolean {
    return this.getPinned().includes(text);
  }

  /**
   * Returns todos sorted by pin status (pinned first) in display order.
   * This is the canonical order used by both the menu and the drawer.
   */
  getSortedTodos(): string[] {
    const { todos, pinned } = this.snapshot();
    return [...todos].sort((a, b) => {
      const aP = pinned.includes(a);
      const bP = pinned.includes(b);
      if (aP && !bP) return -1;
      if (!aP && bP) return 1;
      return 0;
    });
  }

  // ─── Mutations ──────────────────────────────────────────────────────────────

  /**
   * Add a new todo. No-ops silently on empty or duplicate text.
   * Returns true if the item was actually added.
   */
  add(text: string): boolean {
    if (!text) return false;
    const todos = this.getTodos();
    if (todos.includes(text)) {
      Logger.info(`Attempted to add duplicate todo → "${text}"`);
      return false;
    }
    this._settings.set_strv("todos", [...todos, text]);
    Logger.info(`Added todo → "${text}"`);
    return true;
  }

  /**
     * Remove a todo from all lists (todos, completed, pinned).
     * Calculates nextFocusText so the renderer can restore keyboard focus
     * to the logical successor after the item's Clutter actor is destroyed.
     */
  delete(text: string): void {
    // ─── Spatial Focus Calculation ───
    // Before removing the data, determine which item is visually adjacent 
    // to it so we can hand off keyboard focus after the UI rebuilds.
    const { completed } = this.snapshot();
    const isCurrentlyCompleted = completed.includes(text);

    // Reconstruct the visual order of whichever list the item currently lives in
    let visual = this.getSortedTodos();
    visual = isCurrentlyCompleted
      ? visual.filter(t => completed.includes(t))
      : visual.filter(t => !completed.includes(t));

    const idx = visual.indexOf(text);

    // Pick the next item if available, otherwise fall back to the previous item
    this.nextFocusText =
      idx !== -1 && idx + 1 < visual.length ? visual[idx + 1] :
        idx !== -1 && idx - 1 >= 0 ? visual[idx - 1] :
          null;

    // ─── Data Mutation ───
    this._settings.set_strv("todos", this.getTodos().filter(t => t !== text));
    this._settings.set_strv("completed", this.getCompleted().filter(t => t !== text));
    this._settings.set_strv("pinned", this.getPinned().filter(t => t !== text));
  }

  /**
   * Toggle the completed state of a todo.
   * Also calculates and stores nextFocusText so the renderer can restore
   * keyboard focus to the logical successor after the list rebuilds.
   */
  toggle(text: string): void {
    const { completed } = this.snapshot();
    const isCurrentlyCompleted = completed.includes(text);

    // Reconstruct the visual order of whichever list the item currently lives in
    let visual = this.getSortedTodos();
    visual = isCurrentlyCompleted
      ? visual.filter(t => completed.includes(t))
      : visual.filter(t => !completed.includes(t));

    const idx = visual.indexOf(text);
    this.nextFocusText =
      idx !== -1 && idx + 1 < visual.length ? visual[idx + 1] :
        idx !== -1 && idx - 1 >= 0 ? visual[idx - 1] :
          null;

    if (isCurrentlyCompleted) {
      this._settings.set_strv("completed", completed.filter(t => t !== text));
    } else {
      this._settings.set_strv("completed", [...completed, text]);
    }
  }

  /**
   * Rename a todo in all lists. No-ops if newText already exists (collision).
   * Returns true if the rename succeeded.
   */
  rename(oldText: string, newText: string): boolean {
    if (!newText || newText === oldText) return false;
    if (this.getTodos().includes(newText)) {
      Logger.info(`Cannot rename to "${newText}": already exists.`);
      return false;
    }

    const replace = (arr: string[]) => arr.map(t => t === oldText ? newText : t);

    this._settings.set_strv("todos", replace(this.getTodos()));
    this._settings.set_strv("completed", replace(this.getCompleted()));
    this._settings.set_strv("pinned", replace(this.getPinned()));
    return true;
  }

  /**
   * Toggle pin status for a todo.
   */
  togglePin(text: string): void {
    const pinned = this.getPinned();
    if (pinned.includes(text)) {
      this._settings.set_strv("pinned", pinned.filter(t => t !== text));
    } else {
      this._settings.set_strv("pinned", [...pinned, text]);
    }
  }

  /**
     * Move sourceText to the position currently occupied by targetText
     * (drag-and-drop reorder).
     */
  reorder(sourceText: string, targetText: string): void {
    const todos = [...this.getTodos()];
    const srcIdx = todos.indexOf(sourceText);
    const tgtIdx = todos.indexOf(targetText);

    if (srcIdx === -1 || tgtIdx === -1 || srcIdx === tgtIdx) return;

    // 1. Remove the dragged item from its original position
    todos.splice(srcIdx, 1);

    // 2. Insert it exactly at the original target index.
    // Why this works natively:
    // - Dragging UP: Removing the source doesn't change the target's index. 
    //   Inserting at tgtIdx pushes the target down 1 slot.
    // - Dragging DOWN: Removing the source shifts the target left by 1 slot.
    //   Inserting at the original tgtIdx places the source perfectly AFTER the target.
    todos.splice(tgtIdx, 0, sourceText);

    Logger.info(`Moved "${sourceText}" to index ${tgtIdx}`);
    this._settings.set_strv("todos", todos);
  }

  /**
     * Move a todo one step up (direction=-1) or down (direction=1) in the
     * visual (sorted) list.
     *
     * Stores nextFocusText + keepHighlight on the service so the renderer can
     * restore keyboard focus to the moved item after the rebuild.
     * Returns false if the move was not possible (already at boundary).
     */
  reorderStep(
    text: string,
    direction: number,
    keepHighlight: boolean,
  ): boolean {
    const { todos, completed, pinned } = this.snapshot();
    const showCompleted = this.getShowCompleted();

    let visual = [...todos].sort((a, b) => {
      const aP = pinned.includes(a);
      const bP = pinned.includes(b);
      if (aP && !bP) return -1;
      if (!aP && bP) return 1;
      return 0;
    });

    if (!showCompleted) {
      visual = visual.filter(t => !completed.includes(t));
    }

    const idx = visual.indexOf(text);
    if (idx === -1) return false;

    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= visual.length) return false;

    const targetText = visual[targetIdx];

    // ─── STRICT BOUNDARY ENFORCEMENT ───
    // Prevent keyboard reordering from implicitly changing pin state.
    // This ensures 1:1 parity with the pointer DND logic, which strictly
    // rejects drops that cross the pinned/unpinned boundary.
    const srcPinned = pinned.includes(text);
    const tgtPinned = pinned.includes(targetText);

    if (srcPinned !== tgtPinned) {
      return false; // Hit the boundary wall, halt the move
    }

    // ─── Reorder Row Data ───
    // Extract and splice into the raw array to persist the new visual placement,
    // avoiding parity lock when crossing pin boundaries.
    const newTodos = [...todos];
    newTodos.splice(newTodos.indexOf(text), 1);

    const targetRawIdx = newTodos.indexOf(targetText);

    // Insert after the target if moving down, or before the target if moving up
    if (direction === 1) {
      newTodos.splice(targetRawIdx + 1, 0, text);
    } else {
      newTodos.splice(targetRawIdx, 0, text);
    }

    // Store focus intent — consumed by TodoListRenderer after render()
    this.nextFocusText = text;
    this.keepHighlight = keepHighlight;

    this._settings.set_strv("todos", newTodos);
    return true;
  }

  // ─── Bulk Operations (Preferences) ──────────────────────────────────────────

  clearCompleted(): void {
    this._settings.set_strv("completed", []);
  }

  clearAll(): void {
    this._settings.set_strv("todos", []);
    this._settings.set_strv("completed", []);
  }
}