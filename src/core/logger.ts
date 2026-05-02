/**
 * core/logger.ts
 * * Responsibility: Advanced Colorized Logger for GNOME Shell.
 */

export const Logger = {
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m',

  info: (msg: string) => {
    print(`${Logger.cyan}[LightTodo]${Logger.reset} ${msg}`);
  },

  error: (msg: string, error?: any) => {
    let output = `${Logger.red}[LightTodo ERROR]${Logger.reset} ${msg}`;
    if (error) {
      if (error.stack) {
        const stackLines = error.stack.split('\n');
        for (const line of stackLines) {
          if (line.trim() !== "") {
            output += `\n${Logger.yellow}[LightTodo]  ↳ ${line.trim()}${Logger.reset}`;
          }
        }
      } else {
        output += `\n${Logger.yellow}[LightTodo]  ↳ ${error.message || error}${Logger.reset}`;
      }
    }
    printerr(output);
  }
};