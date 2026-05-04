/**
 * prefs/guidePage.ts
 * * Responsibility: Assemble the static usage guide using Adwaita action rows.
 */

import Adw from "gi://Adw";

export function buildGuidePage(): Adw.PreferencesPage {
  const guidePage = new Adw.PreferencesPage({
    title: "Guide",
    icon_name: "stop-symbolic",
  });

  // ── Group: The Quick Capture Philosophy ───
  const captureGroup = new Adw.PreferencesGroup({
    title: "The Quick Capture Philosophy",
    description: "Snap Todo lets you write and manage your todos without friction.",
  });
  guidePage.add(captureGroup);

  captureGroup.add(new Adw.ActionRow({ title: "1. Open", subtitle: "Hit Alt + T" }));
  captureGroup.add(new Adw.ActionRow({ title: "2. Write", subtitle: "Type your todo" }));
  captureGroup.add(new Adw.ActionRow({ title: "3. Save", subtitle: "Press Enter" }));

  // ── Group: The Fluidity System ───
  const fluidGroup = new Adw.PreferencesGroup({
    title: "The Fluidity System",
    description: "Navigate, organize, and complete your todos incredibly fast and easy.",
  });
  guidePage.add(fluidGroup);

  fluidGroup.add(new Adw.ActionRow({
    title: "Open Snap-todo",
    subtitle: "Alt + T  — Instantly opens the dropdown menu or slide-out drawer. Focus is automatically trapped in the text entry."
  }));
  fluidGroup.add(new Adw.ActionRow({
    title: "Navigate",
    subtitle: "Up / Down / Tab — Fluidly navigate through your todos."
  }));
  fluidGroup.add(new Adw.ActionRow({
    title: "Reorder Todos",
    subtitle: "Alt + Up/Down — Reorder todos by pressing Alt and moving the todo up or down using arrows."
  }));
  fluidGroup.add(new Adw.ActionRow({
    title: "Toggle Status",
    subtitle: "Space — Mark a todo as completed or active."
  }));
  fluidGroup.add(new Adw.ActionRow({
    title: "Delete Todo",
    subtitle: "Delete — Remove a todo."
  }));
  fluidGroup.add(new Adw.ActionRow({
    title: "Dismiss UI",
    subtitle: "Esc — Close the drawer and return to your workspace."
  }));

  return guidePage;
}