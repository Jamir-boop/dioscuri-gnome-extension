// Test only. Runs inside a private headless GNOME Shell started by run.sh.
// It enables Dioscuri, opens real client windows, presses the real hotkey
// through a virtual keyboard and checks where every window ends up.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

const DIOSCURI = 'dioscuri@jamir-boop.github.io';
const STATE_ACTIVE = 1;
const STATE_ERROR = 3;
const NAMES = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];
const DEFAULT_KEYS = [Clutter.KEY_Super_L, Clutter.KEY_Control_L, Clutter.KEY_End];
const OTHER_KEYS = [Clutter.KEY_Super_L, Clutter.KEY_Alt_L, Clutter.KEY_F8];

const RESULT = GLib.getenv('DIOSCURI_E2E_RESULT');
const WINDOW_SCRIPT = GLib.getenv('DIOSCURI_E2E_WINDOW');
const PREFS_SCRIPT = GLib.getenv('DIOSCURI_E2E_PREFS');
const SHOTS = GLib.getenv('DIOSCURI_E2E_SHOTS') || '';

function sleep(ms) {
    return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}

async function waitFor(what, probe, timeoutMs = 20000) {
    const end = Date.now() + timeoutMs;
    for (;;) {
        const value = probe();
        if (value)
            return value;
        if (Date.now() > end)
            throw new Error(`Timed out waiting for ${what}`);
        // eslint-disable-next-line no-await-in-loop
        await sleep(100);
    }
}

function monitorOrder() {
    const monitors = [];
    for (let index = 0; index < global.display.get_n_monitors(); index++) {
        const {x, y} = global.display.get_monitor_geometry(index);
        monitors.push({index, x, y});
    }
    return monitors.sort((a, b) => a.x - b.x || a.y - b.y || a.index - b.index).map(m => m.index);
}

function describe(window) {
    return {
        monitor: window.get_monitor(),
        workspace: window.get_workspace()?.index() ?? -1,
        maximized: window.get_maximized() === Meta.MaximizeFlags.BOTH,
        minimized: window.minimized,
        fullscreen: window.fullscreen,
    };
}

export default class DioscuriE2EDriver extends Extension {
    enable() {
        this._lines = [];
        this._failed = false;
        this._notifications = [];

        // Record every system notification, including Dioscuri's first-run one.
        const source = MessageTray.getSystemSource();
        const addNotification = source.addNotification.bind(source);
        source.addNotification = notification => {
            this._notifications.push(notification.body ?? '');
            addNotification(notification);
        };

        this._run()
            .catch(error => this._check(`no exception (${error.message})`, false, error.stack))
            .finally(() => this._finish());
    }

    disable() {
    }

    _check(name, ok, detail = '') {
        // Timestamped in the shell log, to line up with shell warnings.
        console.log(`dioscuri-e2e: ${ok ? 'PASS' : 'FAIL'} ${name}`);
        if (!ok)
            this._failed = true;
        this._lines.push(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? `\n     ${detail}` : ''}`);
    }

    _finish() {
        this._lines.push(`RESULT ${this._failed ? 'FAIL' : 'PASS'}`);
        GLib.file_set_contents(RESULT, `${this._lines.join('\n')}\n`);
        global.context.terminate();
    }

    async _run() {
        if (Main.layoutManager._startingUp)
            await new Promise(resolve => Main.layoutManager.connect('startup-complete', resolve));

        // A fresh virtual keyboard can drop its very first events, so create
        // it before any test presses a key.
        const seat = Clutter.get_default_backend().get_default_seat();
        this._keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        await sleep(500);

        // GNOME starts in the overview. Leave it so keys reach the desktop
        // the way they do during normal use.
        Main.overview.hide();
        await waitFor('overview to close', () => !Main.overview.visible && !Main.overview.animationInProgress);

        const count = global.display.get_n_monitors();
        this._check(`shell reports ${count} monitor(s)`, count >= 1);

        Main.extensionManager.enableExtension(DIOSCURI);
        const extension = await waitFor('Dioscuri to activate', () => {
            const found = Main.extensionManager.lookup(DIOSCURI);
            if (found?.state === STATE_ERROR)
                throw new Error(`Dioscuri failed to load: ${found.error}`);
            return found?.state === STATE_ACTIVE ? found : null;
        });
        const dioscuri = extension.stateObj;
        const settings = dioscuri.getSettings();
        this._check('Dioscuri activates', true);

        await sleep(300);
        this._check('first-run notification names the hotkey',
            this._notifications.includes('Dioscuri is running. Press Ctrl+Super+End to rotate windows forwards.'),
            JSON.stringify(this._notifications));
        this._check('first-run notification is remembered', settings.get_boolean('welcome-shown'));

        const indicator = Main.panel.statusArea[DIOSCURI];
        const labels = () => indicator.menu._getMenuItems().map(item => item.label?.text);
        this._check('top bar indicator exists', Boolean(indicator));
        this._check('menu shows rotate and hotkey items',
            JSON.stringify(labels()) === JSON.stringify(['Rotate screens forwards', 'Configure hotkey (Ctrl+Super+End)…']),
            JSON.stringify(labels()));

        if (SHOTS) {
            indicator.menu.open();
            await sleep(800);
            const [x, y] = indicator.menu.actor.get_transformed_position();
            const [width, height] = indicator.menu.actor.get_transformed_size();
            await this._shot('menu', {x: x - 16, y: 0, width: width + 32, height: y + height + 16});
            indicator.menu.close();
        }

        for (const name of NAMES)
            GLib.spawn_async(null, ['gjs', '-m', WINDOW_SCRIPT, name], null, GLib.SpawnFlags.SEARCH_PATH, null);
        const windows = await waitFor('client windows', () => {
            const found = new Map(global.get_window_actors()
                .map(actor => actor.meta_window)
                .filter(window => NAMES.includes(window.get_title()))
                .map(window => [window.get_title(), window]));
            return found.size === NAMES.length ? found : null;
        }, 60000);
        await sleep(1000);
        this._check('client windows mapped', true);

        if (count === 1) {
            await this._singleMonitor(windows);
            return;
        }
        await this._arrange(windows, count);
        await this._rotations(windows, dioscuri, settings, indicator, labels);
        await this._preferences();
        if (SHOTS)
            await this._screenshots(settings);
    }

    async _arrange(windows, count) {
        const primary = global.display.get_primary_monitor();
        const place = (window, monitor) => {
            const {x, y} = global.display.get_monitor_geometry(monitor);
            window.move_frame(true, x + 60, y + 90);
        };
        const w = name => windows.get(name);
        place(w('alpha'), 0);
        place(w('beta'), 1 % count);
        place(w('gamma'), 0);
        place(w('delta'), 1 % count);
        place(w('zeta'), count - 1);
        place(w('epsilon'), primary);
        await sleep(500);
        w('gamma').maximize(Meta.MaximizeFlags.BOTH);
        w('delta').minimize();
        w('zeta').make_fullscreen();
        w('epsilon').change_workspace_by_index(1, false);
        await sleep(1500);

        const state = this._snapshot(windows);
        this._check('setup: gamma maximized, delta minimized, zeta fullscreen',
            state.gamma.maximized && state.delta.minimized && state.zeta.fullscreen, JSON.stringify(state));
        this._check('setup: epsilon on workspace 2', state.epsilon.workspace === 1, JSON.stringify(state.epsilon));
    }

    _snapshot(windows) {
        return Object.fromEntries(NAMES.map(name => [name, describe(windows.get(name))]));
    }

    _expectRotated(label, before, after) {
        const order = monitorOrder();
        for (const name of NAMES) {
            const expected = {...before[name]};
            if (name !== 'epsilon')
                expected.monitor = order[(order.indexOf(before[name].monitor) + 1) % order.length];
            this._check(`${label}: ${name} ${name === 'epsilon' ? 'stays on its workspace and monitor' : `moves ${before[name].monitor} to ${expected.monitor} and keeps its state`}`,
                JSON.stringify(after[name]) === JSON.stringify(expected),
                `expected ${JSON.stringify(expected)} got ${JSON.stringify(after[name])}`);
        }
    }

    _expectUnchanged(label, before, after) {
        this._check(label, JSON.stringify(before) === JSON.stringify(after),
            `before ${JSON.stringify(before)} after ${JSON.stringify(after)}`);
    }

    async _press(keys) {
        let time = GLib.get_monotonic_time();
        for (const key of keys)
            this._keyboard.notify_keyval(time++, key, Clutter.KeyState.PRESSED);
        for (const key of [...keys].reverse())
            this._keyboard.notify_keyval(time++, key, Clutter.KeyState.RELEASED);
        await sleep(1200);
    }

    async _rotations(windows, dioscuri, settings, indicator, labels) {
        let before = this._snapshot(windows);
        await this._press(DEFAULT_KEYS);
        let after = this._snapshot(windows);
        this._expectRotated('hotkey Ctrl+Super+End', before, after);

        before = after;
        indicator.menu._getMenuItems()[0].activate(null);
        await sleep(1200);
        after = this._snapshot(windows);
        this._expectRotated('menu item', before, after);
        settings.set_boolean('hotkey-enabled', false);
        await sleep(300);
        this._check('menu shows disabled hotkey', labels()[1] === 'Configure hotkey (Disabled)…', labels()[1]);
        before = after;
        await this._press(DEFAULT_KEYS);
        after = this._snapshot(windows);
        this._expectUnchanged('disabled hotkey does nothing', before, after);

        settings.set_boolean('hotkey-enabled', true);
        settings.set_strv('rotate-forward', ['<Super><Alt>F8']);
        await sleep(500);
        this._check('menu follows a changed hotkey', labels()[1] === 'Configure hotkey (Alt+Super+F8)…', labels()[1]);
        before = after;
        await this._press(DEFAULT_KEYS);
        after = this._snapshot(windows);
        this._expectUnchanged('old hotkey released after change', before, after);
        await this._press(OTHER_KEYS);
        after = this._snapshot(windows);
        this._expectRotated('new hotkey Alt+Super+F8', before, after);
        settings.reset('rotate-forward');
        await sleep(300);

        Main.extensionManager.disableExtension(DIOSCURI);
        await waitFor('Dioscuri to deactivate', () => Main.extensionManager.lookup(DIOSCURI)?.state !== STATE_ACTIVE);
        await sleep(300);
        this._check('disable removes the indicator', !Main.panel.statusArea[DIOSCURI]);
        before = this._snapshot(windows);
        await this._press(DEFAULT_KEYS);
        after = this._snapshot(windows);
        this._expectUnchanged('disable removes the hotkey', before, after);

        Main.extensionManager.enableExtension(DIOSCURI);
        const extension = await waitFor('Dioscuri to reactivate',
            () => Main.extensionManager.lookup(DIOSCURI)?.state === STATE_ACTIVE && Main.extensionManager.lookup(DIOSCURI));
        await sleep(300);
        before = after;
        await this._press(DEFAULT_KEYS);
        after = this._snapshot(windows);
        this._expectRotated('hotkey after disable and enable', before, after);
        // The hotkey must also work while the overview is open. Only bound
        // keys are pressed there: the overview treats End as "go to the last
        // workspace", which would leave no windows on the active workspace.
        Main.overview.show();
        await waitFor('overview to open', () => Main.overview.visible && !Main.overview.animationInProgress);
        before = after;
        await this._press(DEFAULT_KEYS);
        after = this._snapshot(windows);
        this._expectRotated('hotkey inside the overview', before, after);
        Main.overview.hide();
        await waitFor('overview to close', () => !Main.overview.visible && !Main.overview.animationInProgress);

        this._check('active workspace never changed',
            global.workspace_manager.get_active_workspace_index() === 0,
            `active workspace ${global.workspace_manager.get_active_workspace_index()}`);
        this._check('first-run notification shown only once',
            this._notifications.filter(text => text.startsWith('Dioscuri is running')).length === 1,
            JSON.stringify(this._notifications));
        this._dioscuri = extension.stateObj;
    }

    async _preferences() {
        const result = `${RESULT}.prefs`;
        const extensionDir = Main.extensionManager.lookup(DIOSCURI).path;
        GLib.spawn_async(null, ['gjs', '-m', PREFS_SCRIPT, extensionDir, result], null,
            GLib.SpawnFlags.SEARCH_PATH, null);
        await waitFor('preferences test', () => GLib.file_test(result, GLib.FileTest.EXISTS), 60000);
        const [, bytes] = GLib.file_get_contents(result);
        for (const line of new TextDecoder().decode(bytes).trim().split('\n')) {
            if (line.startsWith('PREFS '))
                this._check('preferences test finished', line === 'PREFS PASS');
            else
                this._lines.push(line);
        }
    }

    async _singleMonitor(windows) {
        const before = this._snapshot(windows);
        await this._press(DEFAULT_KEYS);
        const after = this._snapshot(windows);
        this._expectUnchanged('one monitor: nothing moves', before, after);
        this._check('one monitor: user is told to connect another monitor',
            this._notifications.includes('Connect at least two monitors before rotating windows.'),
            JSON.stringify(this._notifications));
    }

    async _shot(name, area) {
        const file = Gio.File.new_for_path(`${SHOTS}/${name}.png`);
        const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
        const shooter = new Shell.Screenshot();
        const stage = {width: global.stage.width, height: global.stage.height};
        const x = Math.max(0, Math.round(area.x));
        const y = Math.max(0, Math.round(area.y));
        const width = Math.min(stage.width - x, Math.round(area.width));
        const height = Math.min(stage.height - y, Math.round(area.height));
        await new Promise((resolve, reject) => {
            shooter.screenshot_area(x, y, width, height, stream, (object, result) => {
                try {
                    object.screenshot_area_finish(result);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
        });
        stream.close(null);
    }

    async _screenshots(settings) {
        const dioscuri = this._dioscuri;
        for (const [name, hotkey] of [['prefs', null], ['prefs-conflict', ['<Super>End']]]) {
            if (hotkey)
                settings.set_strv('rotate-forward', hotkey);
            else
                settings.reset('rotate-forward');
            dioscuri.openPreferences();
            // eslint-disable-next-line no-await-in-loop
            const prefs = await waitFor('preferences window', () => global.get_window_actors()
                .map(actor => actor.meta_window)
                .find(window => window.get_title()?.includes('Dioscuri')), 60000);
            // eslint-disable-next-line no-await-in-loop
            await sleep(2500);
            this._check(`${name}: preferences window opens from Dioscuri`, true);
            // eslint-disable-next-line no-await-in-loop
            const frame = prefs.get_frame_rect();
            // eslint-disable-next-line no-await-in-loop
            await this._shot(name, {x: frame.x - 24, y: frame.y - 24, width: frame.width + 48, height: frame.height + 48});
            prefs.delete(global.get_current_time());
            // eslint-disable-next-line no-await-in-loop
            await waitFor('preferences window to close', () => !global.get_window_actors()
                .some(actor => actor.meta_window.get_title()?.includes('Dioscuri')));
        }
        settings.reset('rotate-forward');
    }
}
