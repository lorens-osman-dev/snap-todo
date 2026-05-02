/**
 * core/logger.ts — Colorized Logger
 *
 * Responsibility:
 *   - Provide consistent, grep-friendly logging with ANSI colors
 *   - Format stack traces so `journalctl | grep LightTodo` catches every line
 *
 * Does NOT:
 *   - Access any GNOME APIs
 *   - Hold any state
 */

// ─── ANSI Color Constants ────────────────────────────────────────────────────

const CYAN = '\x1b[36m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

const TAG = `${CYAN}[LightTodo]${RESET}`;
const ETAG = `${RED}[LightTodo ERROR]${RESET}`;

// ─── Public API ──────────────────────────────────────────────────────────────

export const Logger = {
  /**
   * Log an informational message.
   * Visible in: journalctl -f -o cat /usr/bin/gnome-shell | grep LightTodo
   */
  info(msg: string): void {
    print(`${TAG} ${msg}`);
  },

  /**
   * Log an error with a full stack trace.
   * Every line is prefixed with [LightTodo] so grep keeps it.
   */
  error(context: string, error?: unknown): void {
    let output = `${ETAG} ${context}`;

    if (error) {
      const err = error as { stack?: string; message?: string };
      const lines = err.stack
        ? err.stack.split('\n').filter(l => l.trim() !== '')
        : [`${err.message ?? error}`];

      for (const line of lines) {
        output += `\n${YELLOW}[LightTodo]  ↳ ${line.trim()}${RESET}`;
      }
    }

    printerr(output);
  },
};