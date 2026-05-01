// Ambient declarations for GNOME Shell resource imports
// These map short import paths to the @girs packages

declare module "resource:///org/gnome/shell/ui/panelMenu.js" {
  export * from "@girs/gnome-shell/ui/panelMenu";
}

declare module "resource:///org/gnome/shell/ui/popupMenu.js" {
  export * from "@girs/gnome-shell/ui/popupMenu";
}

declare module "resource:///org/gnome/shell/ui/main.js" {
  export * from "@girs/gnome-shell/ui/main";
}

declare module "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js" {
  export * from "@girs/gnome-shell/extensions/prefs";
}

declare module "resource:///org/gnome/shell/extensions/extension.js" {
  export * from "@girs/gnome-shell/extensions/extension";
}

// ambient.d.ts

// ... existing resource declarations ...

// Declare the global console API provided by GJS
declare var console: {
  debug(...data: any[]): void;
  log(...data: any[]): void;
  warn(...data: any[]): void;
  error(...data: any[]): void;
};

declare module "resource:///org/gnome/shell/ui/dnd.js" {
  export * from "@girs/gnome-shell/ui/dnd";
}