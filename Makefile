# Makefile — Snap Todo GNOME Extension
#
# Targets:
#   make          → compile TypeScript → dist/
#   make install  → compile + copy to ~/.local/share/gnome-shell/extensions/
#   make pack     → compile + create distributable .zip
#   make clean    → remove generated files
#   make schema   → compile GSettings schema only
#   make test     → launch nested Wayland GNOME Shell session for testing

UUID      := snap-todo@lorens.com
DIST      := dist
INSTALL   := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
TSC       := node_modules/.bin/tsc

# ── Build ─────────────────────────────────────────────────────────────────────

.PHONY: build
build: node_modules $(DIST)/extension.js $(DIST)/prefs.js

node_modules:
	npm install --legacy-peer-deps

# Find all TypeScript files in the src directory recursively
TS_SOURCES := $(shell find src -type f -name '*.ts')

# We trigger on ANY TypeScript file change, letting tsc compile the whole project
$(DIST)/extension.js $(DIST)/prefs.js: $(TS_SOURCES) tsconfig.json
	$(TSC)

# ── Schema ────────────────────────────────────────────────────────────────────

.PHONY: schema
schema: schemas/gschemas.compiled

schemas/gschemas.compiled: schemas/org.gnome.shell.extensions.snap-todo.gschema.xml
	glib-compile-schemas schemas/

# ── Install ───────────────────────────────────────────────────────────────────

.PHONY: install
install: build schema
	mkdir -p $(INSTALL)
	# Recursively copy all files AND subdirectories from dist/
	cp -r $(DIST)/* $(INSTALL)/
	cp    metadata.json   $(INSTALL)/
	cp    stylesheet.css  $(INSTALL)/
	mkdir -p $(INSTALL)/schemas
	cp    schemas/*.xml              $(INSTALL)/schemas/
	cp    schemas/gschemas.compiled  $(INSTALL)/schemas/
	@echo ""
	@echo "✅  Installed to $(INSTALL)"
	@echo "    → Log out and back in, then enable:"
	@echo "    gnome-extensions enable $(UUID)"

# ── Pack (zip for distribution) ───────────────────────────────────────────────

.PHONY: pack
pack: build schema
	rm -f $(UUID).zip
	mkdir -p _pack
	# Recursively copy all files AND subdirectories for the zip as well
	cp -r $(DIST)/* _pack/
	cp metadata.json  _pack/
	cp stylesheet.css _pack/
	cp -r schemas     _pack/
	cd _pack && zip -r ../$(UUID).zip .
	rm -rf _pack
	@echo "📦  Created $(UUID).zip"
# ── Test (nested Wayland session) ────────────────────────────────────────────
#
# GNOME 49+: uses --devkit
# GNOME 45-48: uses --nested
#
# After the window appears, open a terminal INSIDE it and run:
#   gnome-extensions enable snap-todo@lorens.com

.PHONY: test
test: install
	@echo "🚀  Starting nested GNOME Shell (Wayland)…"
	@echo "    Inside the new window, run:"
	@echo "    gnome-extensions enable $(UUID)"
	@echo ""
	MUTTER_DEBUG_DUMMY_MODE_SPECS="1280x720" \
	G_MESSAGES_DEBUG=all \
	dbus-run-session gnome-shell --nested --wayland 2>&1 | grep  --line-buffered "SnapTodo"

# For GNOME 49+, use devkit instead:
.PHONY: test-devkit
test-devkit: install
	@echo "🚀  Starting nested GNOME Shell (Wayland)…"
	@echo "    Inside the new window, run:"
	@echo "    gnome-extensions enable $(UUID)"
	@echo ""
	MUTTER_DEBUG_DUMMY_MODE_SPECS="1280x720" \
	G_MESSAGES_DEBUG=all \
	dbus-run-session gnome-shell --devkit --wayland 2>&1 | grep  --line-buffered "SnapTodo"

# ── Logs ──────────────────────────────────────────────────────────────────────

.PHONY: logs
logs:
	journalctl -f -o cat /usr/bin/gnome-shell

.PHONY: prefs-logs
prefs-logs:
	journalctl -f -o cat /usr/bin/gjs

# ── Clean ─────────────────────────────────────────────────────────────────────

.PHONY: clean
clean:
	rm -rf $(DIST)
	rm -rf _pack
	rm -f  $(UUID).zip
	rm -f  schemas/gschemas.compiled