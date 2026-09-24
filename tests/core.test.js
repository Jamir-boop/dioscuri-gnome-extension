import assert from 'node:assert/strict';
import {test} from 'node:test';

import {formatAccelerator, planRotation} from '../core.js';

const LEFT = {index: 1, x: 0, y: 0};
const RIGHT = {index: 0, x: 1920, y: 0};

test('two monitors swap every window', () => {
    const moves = planRotation([RIGHT, LEFT], [
        {window: 'editor', monitor: 1},
        {window: 'browser', monitor: 0},
    ]);
    assert.deepEqual(moves, [
        {window: 'editor', from: 1, to: 0},
        {window: 'browser', from: 0, to: 1},
    ]);
});

test('three monitors rotate left to right and wrap', () => {
    const monitors = [
        {index: 0, x: 1920, y: 0},
        {index: 1, x: 0, y: 0},
        {index: 2, x: 3840, y: 0},
    ];
    const moves = planRotation(monitors, [
        {window: 'a', monitor: 1},
        {window: 'b', monitor: 0},
        {window: 'c', monitor: 2},
    ]);
    assert.deepEqual(moves.map(m => [m.window, m.to]), [['a', 0], ['b', 2], ['c', 1]]);
});

test('stacked monitors rotate top to bottom', () => {
    const top = {index: 0, x: 0, y: -1080};
    const bottom = {index: 1, x: 0, y: 0};
    assert.deepEqual(planRotation([bottom, top], [{window: 'a', monitor: 0}]),
        [{window: 'a', from: 0, to: 1}]);
});

test('one monitor moves nothing', () => {
    assert.deepEqual(planRotation([LEFT], [{window: 'a', monitor: 1}]), []);
});

test('window on unknown monitor stays put', () => {
    assert.deepEqual(planRotation([RIGHT, LEFT], [{window: 'ghost', monitor: 5}]), []);
});

test('accelerators become readable labels', () => {
    assert.equal(formatAccelerator('<Super><Control>End'), 'Super+Control+End');
    assert.equal(formatAccelerator('<Alt>F8'), 'Alt+F8');
    assert.equal(formatAccelerator(''), 'Disabled');
    assert.equal(formatAccelerator(undefined), 'Disabled');
});
