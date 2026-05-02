/**
 * utils/tooltip.ts
 * * Responsibility: Attaches a floating tooltip to any St.Widget safely.
 */

import St from "gi://St";
import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

export function setupTooltip(actor: St.Widget, text: string | (() => string)): void {
  let tooltip: St.Label | null = null;
  let timeoutId: number | null = null;

  const destroyTooltip = () => {
    if (timeoutId) {
      GLib.source_remove(timeoutId);
      timeoutId = null;
    }
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

        tooltip = new St.Label({
          text: tipText,
          style_class: "todo-tooltip",
        });

        Main.layoutManager.uiGroup.add_child(tooltip);
        tooltip.get_allocation_box();

        const [x, y] = actor.get_transformed_position();
        const [w, _h] = actor.get_transformed_size();

        const tipX = x + (w / 2) - (tooltip.width / 2);
        const tipY = y - tooltip.height - 6;

        tooltip.set_position(tipX, tipY);

        return GLib.SOURCE_REMOVE;
      }, null);
    } else {
      destroyTooltip();
    }
  });

  actor.connect("destroy", destroyTooltip);
  actor.connect("hide", destroyTooltip);
}