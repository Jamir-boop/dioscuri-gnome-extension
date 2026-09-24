import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {formatAccelerator} from './core.js';

const HOTKEY = 'rotate-forward';
const HOTKEY_ENABLED = 'hotkey-enabled';

// Built-in GNOME shortcuts. A Dioscuri hotkey that matches one of these
// will not work reliably, so the preferences window warns about it.
const GNOME_KEYBINDING_SCHEMAS = [
    'org.gnome.desktop.wm.keybindings',
    'org.gnome.mutter.keybindings',
    'org.gnome.mutter.wayland.keybindings',
    'org.gnome.shell.keybindings',
    'org.gnome.settings-daemon.plugins.media-keys',
];

/**
 * @param {string} accelerator
 * @returns {string[]} names of the GNOME shortcuts that use the same keys
 */
export function findGnomeConflicts(accelerator) {
    const [parsed, keyval, mods] = Gtk.accelerator_parse(accelerator);
    if (!parsed || keyval === 0)
        return [];

    const source = Gio.SettingsSchemaSource.get_default();
    const conflicts = new Set();
    for (const id of GNOME_KEYBINDING_SCHEMAS) {
        const schema = source?.lookup(id, true);
        if (!schema)
            continue;
        const settings = new Gio.Settings({settings_schema: schema});
        for (const name of schema.list_keys()) {
            const key = schema.get_key(name);
            if (key.get_value_type().dup_string() !== 'as')
                continue;
            for (const other of settings.get_strv(name)) {
                const [ok, otherKeyval, otherMods] = Gtk.accelerator_parse(other);
                if (ok && otherMods === mods &&
                    Gdk.keyval_to_lower(otherKeyval) === Gdk.keyval_to_lower(keyval))
                    conflicts.add(key.get_summary() || name);
            }
        }
    }
    return [...conflicts];
}

function normalizeKeyval(widget, controller, keyval, keycode, state) {
    // Shift+1 reports "exclam". Store the unshifted key, like GNOME Settings.
    if (state & Gdk.ModifierType.SHIFT_MASK) {
        const group = controller.get_current_event()?.get_layout() ?? 0;
        const [ok, unshifted] = widget.get_display().translate_key(
            keycode, state & ~Gdk.ModifierType.SHIFT_MASK, group);
        if (ok && unshifted !== 0)
            keyval = unshifted;
    }
    if (keyval === Gdk.KEY_ISO_Left_Tab)
        keyval = Gdk.KEY_Tab;
    return Gdk.keyval_to_lower(keyval);
}

export default class DioscuriPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;

        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        const hotkeyGroup = new Adw.PreferencesGroup({
            title: 'Hotkey',
            description: 'Choose the shortcut that rotates screens forwards.',
        });
        page.add(hotkeyGroup);

        const enabledRow = new Adw.SwitchRow({title: 'Enable this hotkey'});
        settings.bind(HOTKEY_ENABLED, enabledRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        hotkeyGroup.add(enabledRow);

        const shortcutRow = new Adw.ActionRow({title: 'Shortcut'});
        const shortcutLabel = new Gtk.ShortcutLabel({
            disabled_text: 'None',
            valign: Gtk.Align.CENTER,
        });
        const changeButton = new Gtk.Button({
            label: 'Change…',
            valign: Gtk.Align.CENTER,
        });
        const resetButton = new Gtk.Button({
            icon_name: 'edit-undo-symbolic',
            tooltip_text: 'Reset to default',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        shortcutRow.add_suffix(shortcutLabel);
        shortcutRow.add_suffix(changeButton);
        shortcutRow.add_suffix(resetButton);
        shortcutRow.activatable_widget = changeButton;
        settings.bind(HOTKEY_ENABLED, shortcutRow, 'sensitive', Gio.SettingsBindFlags.GET);
        hotkeyGroup.add(shortcutRow);

        const conflictRow = new Adw.ActionRow({title: 'Also used by GNOME'});
        conflictRow.add_prefix(new Gtk.Image({icon_name: 'dialog-warning-symbolic'}));
        hotkeyGroup.add(conflictRow);

        const sync = () => {
            const [accelerator = ''] = settings.get_strv(HOTKEY);
            shortcutLabel.accelerator = accelerator;
            const conflicts = accelerator ? findGnomeConflicts(accelerator) : [];
            conflictRow.subtitle = `${conflicts.join(', ')}. Choose another shortcut, ` +
                'or clear the GNOME one in Settings, Keyboard, View and Customize Shortcuts.';
            conflictRow.visible = conflicts.length > 0 && settings.get_boolean(HOTKEY_ENABLED);
            resetButton.sensitive = settings.get_user_value(HOTKEY) !== null;
        };
        const handlers = [
            settings.connect(`changed::${HOTKEY}`, sync),
            settings.connect(`changed::${HOTKEY_ENABLED}`, sync),
        ];
        window.connect('close-request', () => {
            handlers.forEach(id => settings.disconnect(id));
            return false;
        });
        sync();

        changeButton.connect('clicked', () => this._captureShortcut(window, settings));
        resetButton.connect('clicked', () => settings.reset(HOTKEY));

        const behaviorGroup = new Adw.PreferencesGroup({
            title: 'Behavior',
            description: 'Every application window on the current workspace moves to the next ' +
                'monitor, left to right, and the last monitor wraps to the first. Normal, ' +
                'minimized, maximized and fullscreen windows keep their state. Windows on other ' +
                'workspaces, tool windows and attached dialogs stay where they are.',
        });
        page.add(behaviorGroup);
    }

    _captureShortcut(parent, settings) {
        const hint = 'Use at least one modifier: Super, Ctrl, Alt or Shift.\nEsc cancels.';
        const status = new Adw.StatusPage({
            icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
            title: 'Press the new shortcut',
            description: hint,
        });
        const toolbar = new Adw.ToolbarView({content: status});
        toolbar.add_top_bar(new Adw.HeaderBar());
        const dialog = new Adw.Window({
            title: 'Set Hotkey',
            modal: true,
            transient_for: parent,
            resizable: false,
            default_width: 440,
            content: toolbar,
        });

        // Keep GNOME from acting on the keys while the user presses them,
        // so a shortcut that is already bound can still be captured.
        const surfaceOf = () => dialog.get_surface();
        dialog.connect('notify::is-active', () => {
            const surface = surfaceOf();
            if (dialog.is_active && typeof surface?.inhibit_system_shortcuts === 'function')
                surface.inhibit_system_shortcuts(null);
        });
        dialog.connect('close-request', () => {
            const surface = surfaceOf();
            if (typeof surface?.restore_system_shortcuts === 'function')
                surface.restore_system_shortcuts();
            return false;
        });

        const controller = new Gtk.EventControllerKey();
        controller.connect('key-pressed', (_controller, keyval, keycode, state) => {
            const mask = state & Gtk.accelerator_get_default_mod_mask();
            if (mask === 0 && keyval === Gdk.KEY_Escape) {
                dialog.close();
                return Gdk.EVENT_STOP;
            }

            const key = normalizeKeyval(dialog, controller, keyval, keycode, state);
            // Lone modifier presses are not valid yet. Wait for the real key.
            if (!Gtk.accelerator_valid(key, mask))
                return Gdk.EVENT_STOP;
            if (mask === 0) {
                status.description = `${formatAccelerator(Gtk.accelerator_name(key, 0))} alone is not allowed. ${hint}`;
                return Gdk.EVENT_STOP;
            }

            settings.set_strv(HOTKEY, [Gtk.accelerator_name(key, mask)]);
            dialog.close();
            return Gdk.EVENT_STOP;
        });
        dialog.add_controller(controller);
        dialog.present();
    }
}
