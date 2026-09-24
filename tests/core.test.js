import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
    desktopBounds,
    formatAccelerator,
    intersects,
    monitorOrder,
    nextMonitor,
    planRotation,
} from '../core.js';

const LEFT = {index: 1, x: 0, y: 0, width: 1920, height: 1080};
const RIGHT = {index: 0, x: 1920, y: 0, width: 2560, height: 1440};

function win(name, monitor, x, y, width = 800, height = 600) {
    return {window: name, monitor, rect: {x, y, width, height}};
}

test('monitors are ordered left to right, then top to bottom', () => {
    assert.deepEqual(monitorOrder([RIGHT, LEFT]), [1, 0]);
    const top = {index: 0, x: 0, y: -1080, width: 1920, height: 1080};
    const bottom = {index: 1, x: 0, y: 0, width: 1920, height: 1080};
    assert.deepEqual(monitorOrder([bottom, top]), [0, 1]);
});

test('next monitor wraps from last to first', () => {
    const order = [1, 0, 2];
    assert.equal(nextMonitor(order, 1), 0);
    assert.equal(nextMonitor(order, 0), 2);
    assert.equal(nextMonitor(order, 2), 1);
    assert.equal(nextMonitor(order, 7), -1);
});

test('two monitors swap every window', () => {
    const moves = planRotation([RIGHT, LEFT], [
        win('editor', 1, 100, 100),
        win('browser', 0, 2000, 100),
    ]);
    assert.deepEqual(moves, [
        {window: 'editor', from: 1, to: 0},
        {window: 'browser', from: 0, to: 1},
    ]);
});

test('three monitors rotate forwards', () => {
    const monitors = [
        {index: 0, x: 1920, y: 0, width: 1920, height: 1080},
        {index: 1, x: 0, y: 0, width: 1920, height: 1080},
        {index: 2, x: 3840, y: 0, width: 1920, height: 1080},
    ];
    const moves = planRotation(monitors, [win('a', 1, 0, 0), win('b', 0, 1920, 0), win('c', 2, 3840, 0)]);
    assert.deepEqual(moves.map(m => [m.window, m.to]), [['a', 0], ['b', 2], ['c', 1]]);
});

test('one monitor moves nothing', () => {
    assert.deepEqual(planRotation([LEFT], [win('a', 1, 0, 0)]), []);
});

test('deliberately off-screen windows stay put', () => {
    const moves = planRotation([RIGHT, LEFT], [
        win('hidden', 1, -5000, -5000),
        win('visible', 1, 10, 10),
    ]);
    assert.deepEqual(moves.map(m => m.window), ['visible']);
});

test('window partly on screen still moves', () => {
    const moves = planRotation([RIGHT, LEFT], [win('edge', 1, -700, 10)]);
    assert.deepEqual(moves.map(m => m.window), ['edge']);
});

test('window on unknown monitor stays put', () => {
    assert.deepEqual(planRotation([RIGHT, LEFT], [win('ghost', 5, 10, 10)]), []);
});

test('desktop bounds cover every monitor', () => {
    assert.deepEqual(desktopBounds([RIGHT, LEFT]), {x: 0, y: 0, width: 4480, height: 1440});
});

test('rectangles that only touch do not intersect', () => {
    assert.equal(intersects({x: 0, y: 0, width: 10, height: 10}, {x: 10, y: 0, width: 10, height: 10}), false);
    assert.equal(intersects({x: 0, y: 0, width: 11, height: 10}, {x: 10, y: 0, width: 10, height: 10}), true);
});

test('accelerators are shown in GTK label order', () => {
    assert.equal(formatAccelerator('<Super><Control>End'), 'Ctrl+Super+End');
    assert.equal(formatAccelerator('<Control><Super>End'), 'Ctrl+Super+End');
    assert.equal(formatAccelerator('<Primary><Shift>a'), 'Shift+Ctrl+A');
    assert.equal(formatAccelerator('<Alt><Shift><Super>Page_Down'), 'Shift+Alt+Super+Page Down');
    assert.equal(formatAccelerator('<Meta><Hyper><Super><Alt><Control><Shift>End'),
        'Shift+Ctrl+Alt+Super+Hyper+Meta+End');
    assert.equal(formatAccelerator('<Super>KP_7'), 'Super+Num 7');
    assert.equal(formatAccelerator('<Super>KP_Add'), 'Super+Num +');
    assert.equal(formatAccelerator('<Control>F5'), 'Ctrl+F5');
    assert.equal(formatAccelerator('<Super>bracketleft'), 'Super+[');
    assert.equal(formatAccelerator(''), 'Disabled');
    assert.equal(formatAccelerator(undefined), 'Disabled');
    assert.equal(formatAccelerator('<Bogus>x'), '<Bogus>x');
    assert.equal(formatAccelerator('<Super>'), '<Super>');
});
