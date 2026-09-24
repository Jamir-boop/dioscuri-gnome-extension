#!/bin/sh
# End-to-end test: runs Dioscuri inside a private headless GNOME Shell with
# virtual monitors, real client windows and a virtual keyboard.
# Nothing touches the running desktop session or your settings.
#
# Usage: tests/e2e/run.sh [monitors]
#   monitors  1, 2 or 3 (default 2)
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
MONITORS=${1:-2}
DRIVER=dioscuri-e2e-driver@dioscuri.test

for tool in gnome-shell gjs gsettings dbus-run-session dbus-daemon glib-compile-schemas timeout; do
    command -v "$tool" >/dev/null 2>&1 || { echo "Missing tool: $tool" >&2; exit 2; }
done

WORK=$(mktemp -d)
SYSTEM_BUS_PID=
cleanup() {
    [ -z "$SYSTEM_BUS_PID" ] || kill "$SYSTEM_BUS_PID" 2>/dev/null || true
    rm -rf "$WORK"
}
trap cleanup EXIT

export HOME="$WORK/home"
export XDG_CONFIG_HOME="$WORK/config"
export XDG_DATA_HOME="$WORK/data"
export XDG_CACHE_HOME="$WORK/cache"
export XDG_STATE_HOME="$WORK/state"
export XDG_RUNTIME_DIR="$WORK/runtime"
mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME" "$XDG_STATE_HOME" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
unset DISPLAY DBUS_SESSION_BUS_ADDRESS
export GSETTINGS_BACKEND=keyfile
export WAYLAND_DISPLAY=dioscuri-e2e
export GDK_BACKEND=wayland
export NO_AT_BRIDGE=1
export GTK_A11Y=none
export DIOSCURI_E2E_RESULT="$WORK/result.txt"
export DIOSCURI_E2E_WINDOW="$ROOT/tests/e2e/window.js"

# Containers often have no system bus. GNOME Shell needs one to start,
# so provide an empty private stand-in. Desktops keep their real bus.
# DIOSCURI_E2E_PRIVATE_SYSTEM_BUS=1 forces the stand-in, as CI does.
if [ -n "${DIOSCURI_E2E_PRIVATE_SYSTEM_BUS:-}" ] ||
    { [ -z "${DBUS_SYSTEM_BUS_ADDRESS:-}" ] && [ ! -S /run/dbus/system_bus_socket ]; }; then
    SYSTEM_BUS_PID=$(dbus-daemon --session --fork --print-pid \
        --address="unix:path=$WORK/system_bus_socket")
    export DBUS_SYSTEM_BUS_ADDRESS="unix:path=$WORK/system_bus_socket"
fi

"$ROOT/install.sh" >/dev/null
mkdir -p "$XDG_DATA_HOME/gnome-shell/extensions/$DRIVER"
cp "$ROOT/tests/e2e/driver/metadata.json" "$ROOT/tests/e2e/driver/extension.js" \
    "$XDG_DATA_HOME/gnome-shell/extensions/$DRIVER/"

gsettings set org.gnome.shell disable-extension-version-validation true
gsettings set org.gnome.shell enabled-extensions "['$DRIVER']"
gsettings set org.gnome.shell welcome-dialog-last-shown-version '999'

set --
i=0
for size in 1280x800 1024x768 1440x900; do
    [ "$i" -lt "$MONITORS" ] || break
    set -- "$@" --virtual-monitor "$size"
    i=$((i + 1))
done

echo "Running GNOME Shell $(gnome-shell --version | cut -d' ' -f3) headless with $MONITORS monitor(s)..."
status=0
timeout 240 dbus-run-session -- gnome-shell --headless --wayland --no-x11 \
    --wayland-display="$WAYLAND_DISPLAY" "$@" >"$WORK/shell.log" 2>&1 || status=$?

if grep -E "JS ERROR|JS WARNING|Gjs-CRITICAL" "$WORK/shell.log" | grep -iE "dioscuri" >"$WORK/js-errors.txt"; then
    echo "JavaScript errors from Dioscuri:" >&2
    cat "$WORK/js-errors.txt" >&2
    status=1
fi

if [ ! -s "$DIOSCURI_E2E_RESULT" ]; then
    echo "No test result (gnome-shell exit $status). Shell log tail:" >&2
    tail -n 60 "$WORK/shell.log" >&2
    exit 1
fi

cat "$DIOSCURI_E2E_RESULT"
if [ -n "${DIOSCURI_E2E_KEEP_LOG:-}" ]; then
    cp "$WORK/shell.log" "$DIOSCURI_E2E_KEEP_LOG"
fi
grep -q '^RESULT PASS$' "$DIOSCURI_E2E_RESULT" && [ "$status" -eq 0 ]
