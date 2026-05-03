/**
 * utils/tooltip.ts
 * * Responsibility: Attaches a floating tooltip to any St.Widget safely.
 */

import St from "gi://St";
import GLib from "gi://GLib";
import Pango from "gi://Pango";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

// ─── Tooltip Manager ───

export function setupTooltip(actor: St.Widget, text: string | (() => string)): void {
  let tooltip: St.Label | null = null;
  let timeoutId: number | null = null;

  const destroyTooltip = () => {
    // CLEANUP: Always remove pending timeouts to prevent memory leaks
    if (timeoutId) {
      GLib.source_remove(timeoutId);
      timeoutId = null;
    }
    // CLEANUP: Destroy the Clutter actor and free resources
    if (tooltip) {
      tooltip.destroy();
      tooltip = null;
    }
  };

  actor.connect("notify::hover", () => {
    if (actor.hover) {
      timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
        if (!actor.hover) return GLib.SOURCE_REMOVE;

        const tipText = typeof text === "function" ? text() : text;
        if (!tipText) return GLib.SOURCE_REMOVE;

        // Ensure any previous tooltip is destroyed before creating a new one
        destroyTooltip();

        // ─── Tooltip Actor Creation ───
        // CRITICAL FIX: Assign to the outer scoped variable. 
        // Do NOT use 'const tooltip =', otherwise destroyTooltip() cannot reach it.
        tooltip = new St.Label({
          text: tipText,
          style_class: "todo-tooltip",
        });

        // ── PANGO WRAP ENFORCEMENT ──
        tooltip.clutter_text.line_wrap = true;
        // WORD_CHAR guarantees that strings without spaces wrap gracefully 
        // instead of piercing through the max-width boundary.
        tooltip.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;

        Main.layoutManager.uiGroup.add_child(tooltip);

        // Force Clutter to allocate geometry so we can measure the physical width/height
        tooltip.get_allocation_box();

        // ─── Geometry and Boundary Calculation ───
        const [x, y] = actor.get_transformed_position();
        const [w, h] = actor.get_transformed_size();

        // Default to horizontally centered above the actor
        let tipX = x + (w / 2) - (tooltip.width / 2);
        let tipY = y - tooltip.height - 6;

        // ── Monitor Edge Collision Detection ──
        // Interrogate the layout manager to find which display monitor the actor is on.
        // We pass the Clutter.Actor directly so Mutter natively calculates the Wayland bounds.
        const monitorIndex = Main.layoutManager.findIndexForActor(actor);
        const monitor = Main.layoutManager.monitors[monitorIndex] || Main.layoutManager.primaryMonitor;

        if (monitor) {
          // Clamp X to the right edge (enforcing a 12px HIG padding)
          if (tipX + tooltip.width > monitor.x + monitor.width) {
            tipX = monitor.x + monitor.width - tooltip.width - 12;
          }
          // Clamp X to the left edge
          if (tipX < monitor.x) {
            tipX = monitor.x + 12;
          }

          // Clamp Y if it bleeds off the top edge (fallback to displaying below the actor)
          if (tipY < monitor.y) {
            tipY = y + h + 6;
          }
        }

        tooltip.set_position(tipX, tipY);

        return GLib.SOURCE_REMOVE;
      }, null);
    } else {
      destroyTooltip();
    }
  });

  // CLEANUP: Bind destruction to the parent actor's lifecycle
  actor.connect("destroy", destroyTooltip);
  actor.connect("hide", destroyTooltip);
}