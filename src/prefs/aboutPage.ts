/**
 * prefs/aboutPage.ts
 * * Responsibility: Assemble the extension metadata/about section.
 */

import Adw from "gi://Adw";
import Gtk from "gi://Gtk";

// 👈 NEW: Accept the extension path as an argument
export function buildAboutPage(extPath: string | null): Adw.PreferencesPage {
  const aboutPage = new Adw.PreferencesPage({
    title: "About",
    icon_name: "help-about-symbolic",
  });

  const aboutGroup = new Adw.PreferencesGroup();
  aboutPage.add(aboutGroup);

  // ─── Logo Rendering ───
  if (extPath) {
    // 1. Load the SVG via Gtk.Picture for high-quality GTK4 rendering
    const logoPicture = Gtk.Picture.new_for_filename(`${extPath}/TODO-SNAP-LOGO-300.svg`);
    logoPicture.set_can_shrink(true);
    logoPicture.set_content_fit(Gtk.ContentFit.CONTAIN);

    // Scale the logo to a reasonable size for a preferences window
    logoPicture.set_size_request(120, 120);

    // 2. Wrap it in a Box for alignment and spacing
    const logoBox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      halign: Gtk.Align.CENTER,
      margin_top: 24,
      margin_bottom: 24,
    });
    logoBox.append(logoPicture);

    // 3. Adwaita Groups require Rows. We use a plain PreferencesRow to hold the Box.
    const logoRow = new Adw.PreferencesRow({
      activatable: false,
    });
    logoRow.set_child(logoBox);

    // Strip the default white card background so the SVG sits flush against the page
    logoRow.add_css_class("background");

    aboutGroup.add(logoRow);
  }

  // ─── Metadata ───
  aboutGroup.add(new Adw.ActionRow({ title: "Author", subtitle: "Lorens Osman" }));
  aboutGroup.add(new Adw.ActionRow({ title: "Email", subtitle: "lorens.osman.dev@gmail.com" }));
  aboutGroup.add(new Adw.ActionRow({ title: "Github", subtitle: "https://github.com/lorens-osman-dev" }));

  return aboutPage;
}