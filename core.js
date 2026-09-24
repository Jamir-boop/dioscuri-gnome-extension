// Pure helpers shared by extension.js, prefs.js and the unit tests.
// Keep this module free of GNOME imports so Node can test it.

const MODIFIER_LABELS = new Map([
    ['super', 'Super'],
    ['hyper', 'Hyper'],
    ['meta', 'Meta'],
    ['control', 'Ctrl'],
    ['primary', 'Ctrl'],
    ['ctrl', 'Ctrl'],
    ['ctl', 'Ctrl'],
    ['shift', 'Shift'],
    ['alt', 'Alt'],
    ['mod1', 'Alt'],
]);

// Same order as GTK labels, so the menu matches the preferences window.
const MODIFIER_ORDER = ['Shift', 'Ctrl', 'Alt', 'Super', 'Hyper', 'Meta'];

const KEY_LABELS = new Map([
    ['Page_Up', 'Page Up'],
    ['Prior', 'Page Up'],
    ['Page_Down', 'Page Down'],
    ['Next', 'Page Down'],
    ['Return', 'Enter'],
    ['BackSpace', 'Backspace'],
    ['Print', 'Print Screen'],
    ['Scroll_Lock', 'Scroll Lock'],
    ['space', 'Space'],
    ['comma', ','],
    ['period', '.'],
    ['minus', '-'],
    ['equal', '='],
    ['plus', '+'],
    ['slash', '/'],
    ['backslash', '\\'],
    ['semicolon', ';'],
    ['apostrophe', "'"],
    ['grave', '`'],
    ['bracketleft', '['],
    ['bracketright', ']'],
    ['KP_Multiply', 'Num *'],
    ['KP_Add', 'Num +'],
    ['KP_Subtract', 'Num -'],
    ['KP_Decimal', 'Num .'],
    ['KP_Divide', 'Num /'],
    ['KP_Enter', 'Num Enter'],
]);

/**
 * Turns a GTK/Mutter accelerator such as "<Super><Control>End" into
 * "Ctrl+Super+End". Returns "Disabled" for an empty value and the raw
 * text for anything it cannot parse.
 *
 * @param {string | undefined} accelerator
 * @returns {string}
 */
export function formatAccelerator(accelerator) {
    if (typeof accelerator !== 'string' || accelerator.length === 0)
        return 'Disabled';

    const modifiers = new Set();
    let rest = accelerator;
    for (let match = /^<([^>]+)>/.exec(rest); match; match = /^<([^>]+)>/.exec(rest)) {
        const label = MODIFIER_LABELS.get(match[1].toLowerCase());
        if (!label)
            return accelerator;
        modifiers.add(label);
        rest = rest.slice(match[0].length);
    }
    if (rest.length === 0)
        return accelerator;

    let key;
    if (KEY_LABELS.has(rest))
        key = KEY_LABELS.get(rest);
    else if (/^KP_\d$/.test(rest))
        key = `Num ${rest.slice(3)}`;
    else if (rest.length === 1)
        key = rest.toUpperCase();
    else
        key = rest.replace(/_/g, ' ');

    return [...MODIFIER_ORDER.filter(name => modifiers.has(name)), key].join('+');
}

/**
 * Monitor indices ordered left to right, then top to bottom.
 * This is the rotation order of the Windows build.
 *
 * @param {{index: number, x: number, y: number}[]} monitors
 * @returns {number[]}
 */
export function monitorOrder(monitors) {
    return [...monitors]
        .sort((a, b) => a.x - b.x || a.y - b.y || a.index - b.index)
        .map(monitor => monitor.index);
}

/**
 * @param {number[]} order result of monitorOrder()
 * @param {number} index current monitor index
 * @returns {number} next monitor index, or -1 when index is unknown
 */
export function nextMonitor(order, index) {
    const position = order.indexOf(index);
    return position < 0 ? -1 : order[(position + 1) % order.length];
}

/**
 * @typedef {{x: number, y: number, width: number, height: number}} Rect
 */

/**
 * @param {Rect} a
 * @param {Rect} b
 * @returns {boolean}
 */
export function intersects(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x &&
        a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Smallest rectangle that contains every monitor.
 *
 * @param {Rect[]} monitors
 * @returns {Rect}
 */
export function desktopBounds(monitors) {
    const left = Math.min(...monitors.map(m => m.x));
    const top = Math.min(...monitors.map(m => m.y));
    const right = Math.max(...monitors.map(m => m.x + m.width));
    const bottom = Math.max(...monitors.map(m => m.y + m.height));
    return {x: left, y: top, width: right - left, height: bottom - top};
}

/**
 * Decides where every window goes. Windows outside the desktop bounds
 * (deliberately off-screen) and windows on an unknown monitor stay put.
 *
 * @template T
 * @param {(Rect & {index: number})[]} monitors
 * @param {{window: T, monitor: number, rect: Rect}[]} windows
 * @returns {{window: T, from: number, to: number}[]}
 */
export function planRotation(monitors, windows) {
    if (monitors.length < 2)
        return [];

    const order = monitorOrder(monitors);
    const bounds = desktopBounds(monitors);
    const moves = [];
    for (const {window, monitor, rect} of windows) {
        if (!intersects(rect, bounds))
            continue;
        const to = nextMonitor(order, monitor);
        if (to >= 0)
            moves.push({window, from: monitor, to});
    }
    return moves;
}
