/**
 * features/todosService.ts
 *
 * Responsibility:
 * - Abstracts all read/write operations for GSettings data (todos, pinned, completed).
 * - Validates data operations (e.g., checking for duplicates).
 * - Exposes UI-intent properties (nextFocusText) so the UI knows where to place 
 * focus after a data mutation triggers a redraw.
 *
 * Does NOT:
 * - Touch Clutter or St actors.
 * - Draw UI.
 */

import Gio from "gi://Gio";
// import logger from "../core/logger.js"; // Assume extracted logger

export class TodosService {
  private _settings: Gio.Settings;

  // ─── UI Intent State ───────────────────────────────────────────────────────
  // Holds data on which item the UI should focus after a rebuild occurs.
  public nextFocusText: string | null = null;
  public keepHighlight: boolean = false;

  constructor(settings: Gio.Settings) {
    this._settings = settings;
  }

  // ─── Data Accessors ────────────────────────────────────────────────────────

  public getTodos(): string[] { return this._settings.get_strv("todos"); }
  public getCompleted(): string[] { return this._settings.get_strv("completed"); }
  public getPinned(): string[] { return this._settings.get_strv("pinned"); }

  public getShowCompleted(): boolean { return this._settings.get_boolean("show-completed"); }
  public getUseDrawer(): boolean { return this._settings.get_boolean("use-drawer"); }

  // ─── Data Mutations ────────────────────────────────────────────────────────

  public addTodo(text: string): boolean {
    if (!text) return false;

    const todos = this.getTodos();
    if (todos.includes(text)) {
      log(`Attempted to add duplicate todo -> "${text}"`);
      return false;
    }

    log(`Successfully added todo -> "${text}"`);
    this._settings.set_strv("todos", [...todos, text]);
    return true;
  }

  public deleteTodo(text: string): void {
    this._settings.set_strv("todos", this.getTodos().filter(t => t !== text));
    this._settings.set_strv("completed", this.getCompleted().filter(t => t !== text));
    this._settings.set_strv("pinned", this.getPinned().filter(t => t !== text));
  }

  public editTodo(oldText: string, newText: string): void {
    const todos = this.getTodos();

    if (todos.includes(newText) && oldText !== newText) {
      log(`Cannot rename to "${newText}": already exists.`);
      return; // A real app might throw an error or return a result enum here
    }

    const newTodos = todos.map(t => t === oldText ? newText : t);
    this._settings.set_strv("todos", newTodos);

    const pinned = this.getPinned();
    if (pinned.includes(oldText)) {
      this._settings.set_strv("pinned", pinned.map(t => t === oldText ? newText : t));
    }

    const completed = this.getCompleted();
    if (completed.includes(oldText)) {
      this._settings.set_strv("completed", completed.map(t => t === oldText ? newText : t));
    }
  }

  public toggleTodo(text: string): void {
    const todos = this.getTodos();
    const completed = this.getCompleted();
    const pinned = this.getPinned();

    const isCurrentlyCompleted = completed.includes(text);

    // Calculate visual order to determine next focus
    let visualList = [...todos].sort((a, b) => {
      const aPinned = pinned.includes(a);
      const bPinned = pinned.includes(b);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return 0;
    });

    if (isCurrentlyCompleted) {
      visualList = visualList.filter(t => completed.includes(t));
    } else {
      visualList = visualList.filter(t => !completed.includes(t));
    }

    const currentIndex = visualList.indexOf(text);
    this.nextFocusText = null;

    if (currentIndex !== -1) {
      if (currentIndex + 1 < visualList.length) {
        this.nextFocusText = visualList[currentIndex + 1];
      } else if (currentIndex - 1 >= 0) {
        this.nextFocusText = visualList[currentIndex - 1];
      }
    }

    // Toggle logic
    if (isCurrentlyCompleted) {
      this._settings.set_strv("completed", completed.filter(t => t !== text));
    } else {
      this._settings.set_strv("completed", [...completed, text]);
    }
  }

  public togglePin(text: string): void {
    const pinned = this.getPinned();
    if (pinned.includes(text)) {
      this._settings.set_strv("pinned", pinned.filter(t => t !== text));
    } else {
      this._settings.set_strv("pinned", [...pinned, text]);
    }
  }

  public moveTodo(sourceText: string, targetText: string): void {
    const todos = this.getTodos();
    const sourceIndex = todos.indexOf(sourceText);
    const targetIndex = todos.indexOf(targetText);

    if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return;

    todos.splice(sourceIndex, 1);
    const newTargetIndex = todos.indexOf(targetText);
    todos.splice(newTargetIndex, 0, sourceText);

    log(`Moved "${sourceText}" to index ${newTargetIndex}`);
    this._settings.set_strv("todos", todos);
  }

  public moveTodoStep(text: string, direction: number, keepHighlight: boolean): void {
    const todos = this.getTodos();
    const pinned = this.getPinned();
    const completed = this.getCompleted();
    const showCompleted = this.getShowCompleted();

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

    // Handle pin inheritance
    const isTargetPinned = pinned.includes(targetText);
    const isSourcePinned = pinned.includes(text);

    if (isTargetPinned !== isSourcePinned) {
      let newPinned = [...pinned];
      if (isTargetPinned) newPinned.push(text);
      else newPinned = newPinned.filter(p => p !== text);
      this._settings.set_strv("pinned", newPinned);
    }

    // Inform UI to maintain focus
    this.nextFocusText = text;
    this.keepHighlight = keepHighlight;

    this._settings.set_strv("todos", mainTodos);
  }
}