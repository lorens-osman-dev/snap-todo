/**
 * services/clipboard.ts — Clipboard Operations
 *
 * Responsibility:
 *   - Format todo lists as Markdown and write to the Wayland clipboard
 *   - Show a GNOME notification confirming the copy
 *
 * Does NOT:
 *   - Render any UI widgets
 *   - Access GSettings directly (receives data as plain arrays)
 */

import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Copy todos to the system clipboard in Markdown task-list format.
 *
 * @param activeTodos   - Active (uncompleted) todo strings
 * @param completedTodos - Completed todo strings
 * @param all           - If false, only active todos are copied
 */
export function copyToClipboard(
  activeTodos: string[],
  completedTodos: string[],
  all: boolean,
): void {
  const lines: string[] = [];

  if (!all) {
    // "Copy Active" — only uncompleted items
    if (activeTodos.length === 0) return;
    lines.push("# Todos:");
    activeTodos.forEach(t => lines.push(`- [ ] ${t}`));
  } else {
    // "Copy All" — active first, then completed
    const total = activeTodos.length + completedTodos.length;
    if (total === 0) return;

    if (activeTodos.length > 0) {
      lines.push("# Todos:");
      activeTodos.forEach(t => lines.push(`- [ ] ${t}`));
    }

    if (completedTodos.length > 0) {
      if (lines.length > 0) lines.push(""); // blank separator line
      lines.push("# Completed Todos:");
      completedTodos.forEach(t => lines.push(`- [x] ${t}`));
    }
  }

  const text = lines.join("\n");

  // Wayland-native clipboard write
  St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);

  // Native GNOME notification (appears in the notification tray)
  const count = all
    ? activeTodos.length + completedTodos.length
    : activeTodos.length;
  Main.notify("Snap Todo", `Copied ${count} item(s) to clipboard`);
}