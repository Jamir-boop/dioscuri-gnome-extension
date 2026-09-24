#!/bin/sh
# Install or remove Dioscuri for the current user.
#   ./install.sh            install or update
#   ./install.sh uninstall  remove
set -eu

UUID=dioscuri@jamir-boop.github.io
SOURCE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARGET="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
FILES="metadata.json extension.js prefs.js core.js LICENSE"

install_extension() {
    if ! command -v glib-compile-schemas >/dev/null 2>&1; then
        echo "glib-compile-schemas not found. Install it: sudo apt install libglib2.0-bin" >&2
        exit 1
    fi
    mkdir -p "$TARGET/schemas" "$TARGET/icons"
    for file in $FILES; do
        cp "$SOURCE/$file" "$TARGET/$file"
    done
    cp "$SOURCE"/schemas/*.gschema.xml "$TARGET/schemas/"
    cp "$SOURCE"/icons/*.svg "$TARGET/icons/"
    glib-compile-schemas --strict "$TARGET/schemas"
    echo "Installed to $TARGET"
    echo "Next:"
    echo "  1. Restart GNOME Shell. X11: Alt+F2, type r, Enter. Wayland: log out and back in."
    echo "  2. gnome-extensions enable $UUID"
}

uninstall_extension() {
    if command -v gnome-extensions >/dev/null 2>&1; then
        gnome-extensions disable "$UUID" 2>/dev/null || true
    fi
    rm -rf -- "$TARGET"
    echo "Removed $TARGET"
}

case "${1:-install}" in
    install) install_extension ;;
    uninstall) uninstall_extension ;;
    *) echo "Usage: $0 [install|uninstall]" >&2; exit 2 ;;
esac
