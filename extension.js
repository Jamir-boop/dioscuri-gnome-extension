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

// Application windows and free-standing dialogs. Docks, desktop icons,
// menus, tooltips and utility palettes are the equivalent of Windows
// tool windows and are left alone.
const MOVABLE_TYPES = [
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
];

function isEligible(window, workspace) {
    return MOVABLE_TYPES.includes(window.get_window_type()) &&
        !window.is_skip_taskbar() &&
        !window.is_attached_dialog() &&
        window.located_on_workspace(workspace);
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

    setHotkey(accelerator) {
        this._hotkeyItem.label.text = `Configure hotkey (${formatAccelerator(accelerator)})…`;
    }
});

export default class DioscuriExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new DioscuriIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        // Mutter follows changes to the shortcut. An empty list disables it.
        const action = Main.wm.addKeybinding(
            HOTKEY,
            this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this.rotateForward());
        if (action === Meta.KeyBindingAction.NONE)
            Main.notify('Dioscuri', 'GNOME could not register the hotkey. Choose another hotkey.');

        this._settings.connectObject(`changed::${HOTKEY}`, () => this._syncLabel(), this);
        this._syncLabel();
    }

    disable() {
        Main.wm.removeKeybinding(HOTKEY);
        this._settings.disconnectObject(this);
        this._indicator.destroy();
        this._indicator = null;
        this._settings = null;
    }

    /**
     * Moves every eligible window on the active workspace to the next
     * monitor. Mutter keeps each window's minimized, maximized, fullscreen
     * and tiled state while it moves.
     */
    rotateForward() {
        const display = global.display;
        const count = display.get_n_monitors();
        if (count < 2) {
            Main.notify('Dioscuri', 'Connect at least two monitors before rotating windows.');
            return;
        }

        const monitors = [];
        for (let index = 0; index < count; index++) {
            const {x, y} = display.get_monitor_geometry(index);
            monitors.push({index, x, y});
        }

        const workspace = global.workspace_manager.get_active_workspace();
        const windows = global.get_window_actors()
            .map(actor => actor.meta_window)
            .filter(window => window && isEligible(window, workspace))
            .map(window => ({window, monitor: window.get_monitor()}));

        // Plan first, then move, so a moved window is never counted twice.
        for (const {window, to} of planRotation(monitors, windows))
            window.move_to_monitor(to);
    }

    _syncLabel() {
        this._indicator.setHotkey(this._settings.get_strv(HOTKEY)[0]);
    }
}
