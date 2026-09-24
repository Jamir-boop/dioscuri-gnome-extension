// Pure helpers shared by extension.js and the unit tests.
// Keep this module free of GNOME imports so Node can test it.

/**
 * "<Super><Control>End" becomes "Super+Control+End".
 *
 * @param {string | undefined} accelerator
 * @returns {string}
 */
export function formatAccelerator(accelerator) {
    return accelerator ? accelerator.replace(/<([^>]+)>/g, '$1+') : 'Disabled';
}

/**
 * Decides where every window goes: the next monitor left to right, then
 * top to bottom, wrapping from the last monitor to the first. Windows on
 * an unknown monitor stay put.
 *
 * @template T
 * @param {{index: number, x: number, y: number}[]} monitors
 * @param {{window: T, monitor: number}[]} windows
 * @returns {{window: T, from: number, to: number}[]}
 */
export function planRotation(monitors, windows) {
    if (monitors.length < 2)
        return [];

    const order = [...monitors]
        .sort((a, b) => a.x - b.x || a.y - b.y || a.index - b.index)
        .map(monitor => monitor.index);
    const moves = [];
    for (const {window, monitor} of windows) {
        const position = order.indexOf(monitor);
        if (position >= 0)
            moves.push({window, from: monitor, to: order[(position + 1) % order.length]});
    }
    return moves;
}
