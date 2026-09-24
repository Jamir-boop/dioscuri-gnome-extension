// Test only. Loads Dioscuri's real prefs.js the way GNOME's Extensions app
// does, then drives the shortcut capture dialog with synthetic key presses.
// Usage: gjs -m prefs-check.js <installed extension dir> <result file>
import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import GIRepository from 'gi://GIRepository?version=2.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import system from 'system';

const [extensionDir, resultPath] = system.programArgs;
const lines = [];
let failed = false;

function check(name, ok, detail = '') {
    if (!ok)
        failed = true;
    lines.push(`${ok ? 'PASS' : 'FAIL'} prefs: ${name}${!ok && detail ? `\n     ${detail}` : ''}`);
}

function sleep(ms) {
    return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}

function findShellData(name) {
    for (const dir of GLib.get_system_data_dirs()) {
        const path = `${dir}/gnome-shell/${name}`;
        if (GLib.file_test(path, GLib.FileTest.EXISTS))
            return path;
    }
    throw new Error(`${name} not found`);
}

function registerResource(name) {
    Gio.Resource.load(findShellData(name))._register();
}

// The Extensions app needs GNOME Shell's private typelibs (Shew). Its
// launcher script names the library directory, so read it from there.
function addShellTypelibs() {
    const [, bytes] = GLib.file_get_contents(findShellData('org.gnome.Shell.Extensions'));
    const libdir = /libdir: '([^']+)'/.exec(new TextDecoder().decode(bytes))?.[1] ?? '/usr/lib';
    GIRepository.Repository.prepend_search_path(`${libdir}/gnome-shell/girepository-1.0`);
    GIRepository.Repository.prepend_library_path(`${libdir}/gnome-shell`);
}

async function main() {
    addShellTypelibs();
    registerResource('org.gnome.Shell.Extensions.src.gresource');
    registerResource('gnome-shell-dbus-interfaces.gresource');
    Gtk.init();
    Adw.init();

    const [, bytes] = GLib.file_get_contents(`${extensionDir}/metadata.json`);
    const metadata = JSON.parse(new TextDecoder().decode(bytes));
    const module = await import(`file://${extensionDir}/prefs.js`);
    const prefs = new module.default({...metadata, dir: Gio.File.new_for_path(extensionDir), path: extensionDir});

    const window = new Adw.PreferencesWindow();
    prefs.fillPreferencesWindow(window);
    window.present();
    await sleep(500);
    const settings = window._settings;
    settings.reset('rotate-forward');
    const hotkey = () => settings.get_strv('rotate-forward')[0];

    check('default hotkey has no GNOME conflict',
        module.findGnomeConflicts('<Super><Control>End').length === 0,
        JSON.stringify(module.findGnomeConflicts('<Super><Control>End')));
    check('Super+End conflict is reported',
        module.findGnomeConflicts('<Super>End').includes('Switch to last workspace'),
        JSON.stringify(module.findGnomeConflicts('<Super>End')));

    const display = Gdk.Display.get_default();
    const keycodeOf = keyval => {
        const [ok, keys] = display.map_keyval(keyval);
        if (!ok || keys.length === 0)
            throw new Error(`no keycode for ${Gdk.keyval_name(keyval)}`);
        return keys[0].keycode;
    };
    const openDialog = async () => {
        prefs._captureShortcut(window, settings);
        await sleep(300);
        const dialog = Gtk.Window.list_toplevels().find(w => w.title === 'Set Hotkey' && w.visible);
        const controllers = [];
        const model = dialog.observe_controllers();
        for (let i = 0; i < model.get_n_items(); i++) {
            const controller = model.get_item(i);
            if (controller instanceof Gtk.EventControllerKey)
                controllers.push(controller);
        }
        // GTK lists the most recently added controller first: Dioscuri's.
        const [controller] = controllers;
        const press = async (keyval, state) => {
            controller.emit('key-pressed', keyval, keycodeOf(keyval), state);
            await sleep(300);
        };
        return {dialog, press, status: () => dialog.get_content().get_content().get_description()};
    };
    const {SHIFT_MASK, CONTROL_MASK, SUPER_MASK} = Gdk.ModifierType;

    let capture = await openDialog();
    check('Change opens the capture dialog', capture.dialog?.visible);
    await capture.press(Gdk.KEY_a, 0);
    check('a key without modifier is refused', hotkey() === '<Super><Control>End' && capture.dialog.visible,
        `${hotkey()} visible=${capture.dialog.visible}`);
    check('refusal is explained', capture.status().startsWith('A alone is not allowed.'), capture.status());
    await capture.press(Gdk.KEY_Shift_L, SHIFT_MASK);
    check('a lone modifier waits for the real key', hotkey() === '<Super><Control>End' && capture.dialog.visible);
    await capture.press(Gdk.KEY_K, SHIFT_MASK | CONTROL_MASK);
    check('Shift+Ctrl+K is saved', hotkey() === '<Shift><Control>k', hotkey());
    check('dialog closes after saving', !capture.dialog.visible);

    capture = await openDialog();
    await capture.press(Gdk.KEY_exclam, SHIFT_MASK | SUPER_MASK);
    check('Shift+Super+1 is saved as the unshifted key', hotkey() === '<Shift><Super>1', hotkey());

    capture = await openDialog();
    await capture.press(Gdk.KEY_Escape, 0);
    check('Escape cancels without saving', hotkey() === '<Shift><Super>1' && !capture.dialog.visible, hotkey());

    settings.reset('rotate-forward');
    check('reset restores the default', hotkey() === '<Super><Control>End' &&
        settings.get_user_value('rotate-forward') === null);
    window.close();
}

const loop = GLib.MainLoop.new(null, false);
main()
    .catch(error => check(`no exception (${error.message})`, false, error.stack))
    .finally(() => {
        lines.push(`PREFS ${failed ? 'FAIL' : 'PASS'}`);
        GLib.file_set_contents(resultPath, `${lines.join('\n')}\n`);
        loop.quit();
    });
loop.run();
