import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {formatAccelerator, planRotation} from './core.js';

const HOTKEY = 'rotate-forward';
const HOTKEY_ENABLED = 'hotkey-enabled';
const WELCOME_SHOWN = 'welcome-shown';

// Application windows and free-standing dialogs. Docks, desktop icons,
// menus, tooltips and utility palettes are the equivalent of Windows
// tool windows and are left alone.
const MOVABLE_TYPES = [
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
];

function isEligible(window, workspace) {
    return !window.is_override_redirect() &&
        MOVABLE_TYPES.includes(window.get_window_type()) &&
        !window.is_skip_taskbar() &&
        !window.is_attached_dialog() &&
        window.located_on_workspace(workspace) &&
        window.get_monitor() >= 0;
}

function hotkeyText(settings) {
    if (!settings.get_boolean(HOTKEY_ENABLED))
        return 'Disabled';
    const [accelerator] = settings.get_strv(HOTKEY);
    return formatAccelerator(accelerator);
}

const DioscuriIndicator = GObject.registerClass(
class DioscuriIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.5, extension.metadata.name);

        this.add_child(new St.Icon({
            gicon: Gio.icon_new_for_string(`${extension.path}/icons/dioscuri-symbolic.svg`),
            style_class: 'system-status-icon',
        }));

        const rotateItem = new PopupMenu.PopupMenuItem('Rotate screens forwards');
        rotateItem.connect('activate', () => extension.rotateForward());
        this.menu.addMenuItem(rotateItem);

        this._hotkeyItem = new PopupMenu.PopupMenuItem('');
        this._hotkeyItem.connect('activate', () => extension.openPreferences());
        this.menu.addMenuItem(this._hotkeyItem);
    }

    setHotkeyText(text) {
        this._hotkeyItem.label.text = `Configure hotkey (${text})…`;
    }
});

export default class DioscuriExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._hotkeyAdded = false;

        this._indicator = new DioscuriIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        // Mutter follows changes to the shortcut itself. Only the on/off
        // switch needs the binding to be added or removed here.
        this._settings.connectObject(
            `changed::${HOTKEY_ENABLED}`, () => this._syncHotkey(),
            `changed::${HOTKEY}`, () => this._syncLabel(),
            this);
        this._syncHotkey();
        this._showWelcome();
    }

    disable() {
        this._removeHotkey();
        this._settings.disconnectObject(this);
        this._indicator.destroy();
        this._indicator = null;
        this._settings = null;
    }

    /**
     * Moves every eligible window on the active workspace to the next
     * monitor, left to right, wrapping from the last monitor to the first.
     * Mutter keeps each window's minimized, maximized, fullscreen and tiled
     * state while it moves.
     *
     * @returns {number} how many windows were asked to move
     */
    rotateForward() {
        const display = global.display;
        const count = display.get_n_monitors();
        if (count < 2) {
            this._notify('Connect at least two monitors before rotating windows.');
            return 0;
        }

        const monitors = [];
        for (let index = 0; index < count; index++) {
            const {x, y, width, height} = display.get_monitor_geometry(index);
            monitors.push({index, x, y, width, height});
        }

        const workspace = global.workspace_manager.get_active_workspace();
        const windows = global.get_window_actors()
            .map(actor => actor.meta_window)
            .filter(window => window && isEligible(window, workspace))
            .map(window => {
                const {x, y, width, height} = window.get_frame_rect();
                return {window, monitor: window.get_monitor(), rect: {x, y, width, height}};
            });

        // Plan first, then move, so a moved window is never counted twice.
        const moves = planRotation(monitors, windows);
        for (const {window, to} of moves)
            window.move_to_monitor(to);
        return moves.length;
    }

    _syncHotkey() {
        this._removeHotkey();
        if (this._settings.get_boolean(HOTKEY_ENABLED)) {
            const action = Main.wm.addKeybinding(
                HOTKEY,
                this._settings,
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                () => this.rotateForward());
            this._hotkeyAdded = action !== Meta.KeyBindingAction.NONE;
            if (!this._hotkeyAdded)
                this._notify(`GNOME could not register ${hotkeyText(this._settings)}. Choose another hotkey.`);
        }
        this._syncLabel();
    }

    _removeHotkey() {
        if (!this._hotkeyAdded)
            return;
        Main.wm.removeKeybinding(HOTKEY);
        this._hotkeyAdded = false;
    }

    _syncLabel() {
        this._indicator.setHotkeyText(hotkeyText(this._settings));
    }

    _showWelcome() {
        if (this._settings.get_boolean(WELCOME_SHOWN))
            return;
        this._settings.set_boolean(WELCOME_SHOWN, true);
        const text = hotkeyText(this._settings);
        this._notify(text === 'Disabled'
            ? 'Dioscuri is running. Use its top bar menu to rotate windows forwards.'
            : `Dioscuri is running. Press ${text} to rotate windows forwards.`);
    }

    _notify(message) {
        Main.notify('Dioscuri', message);
    }
}
