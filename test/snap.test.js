// Unit tests for snap-to-grid and wall-snap logic.
// These functions are pure math — extracted here for testing without Three.js.
// Run with: node test/snap.test.js

const assert = require('assert');

// ── Replicate the functions from scene.js ────────────────────────────────────

const _GRID = 0.25;
function _snapToGrid(v) { return Math.round(v / _GRID) * _GRID; }

function _snapPos(axis, raw, width, depth) {
  const hw = width / 2, hd = depth / 2, snap = 0.35;
  const limit = axis === 'x' ? hd : hw;
  if (Math.abs(raw - limit) < snap)  return  limit;
  if (Math.abs(raw + limit) < snap)  return -limit;
  return Math.max(-limit, Math.min(limit, _snapToGrid(raw)));
}

function _snapEnd(axis, raw, width, depth) {
  const hw = width / 2, hd = depth / 2, snap = 0.35;
  const limit = axis === 'x' ? hw : hd;
  if (Math.abs(raw - limit) < snap)  return  limit;
  if (Math.abs(raw + limit) < snap)  return -limit;
  return Math.max(-limit, Math.min(limit, _snapToGrid(raw)));
}

// ── Tests ────────────────────────────────────────────────────────────────────

function runTests() {
  console.log('Running snap logic tests...');

  // _snapToGrid: rounds to nearest 0.25m
  assert.strictEqual(_snapToGrid(0),      0);
  assert.strictEqual(_snapToGrid(0.1),    0);
  assert.strictEqual(_snapToGrid(0.13),   0.25);
  assert.strictEqual(_snapToGrid(0.25),   0.25);
  assert.strictEqual(_snapToGrid(0.374),  0.25);
  assert.strictEqual(_snapToGrid(0.376),  0.5);
  assert.strictEqual(_snapToGrid(1.0),    1.0);
  // -0.1 rounds to -0 in JS float math; use Math.abs to avoid -0 vs 0 mismatch
  assert.ok(Math.abs(_snapToGrid(-0.1)) === 0,   '-0.1 snaps to 0');
  assert.strictEqual(_snapToGrid(-0.13), -0.25);
  assert.strictEqual(_snapToGrid(3.7),    3.75);
  console.log('  _snapToGrid ✓');

  // _snapPos: clamps to room half-depth on 'x' axis, snaps walls within 0.35m
  // Room 6×4 → hw=3, hd=2
  const W = 6, D = 4;
  // Far from walls → grid snap
  assert.strictEqual(_snapPos('x', 0.6, W, D),   0.5);
  assert.strictEqual(_snapPos('x', 1.1, W, D),   1.0);
  // Near positive wall (hd=2): 1.75 is within 0.35 of 2
  assert.strictEqual(_snapPos('x', 1.75, W, D),  2.0);
  // Near negative wall: -1.75 is within 0.35 of -2
  assert.strictEqual(_snapPos('x', -1.75, W, D), -2.0);
  // Beyond wall limit: clamped
  assert.strictEqual(_snapPos('x', 3.0, W, D),   2.0);
  assert.strictEqual(_snapPos('x', -3.0, W, D), -2.0);
  console.log('  _snapPos ✓');

  // _snapEnd: clamps to room half-width on 'x' axis
  // Near hw=3: 2.8 is within 0.35 → snaps to 3
  assert.strictEqual(_snapEnd('x', 2.8, W, D),   3.0);
  assert.strictEqual(_snapEnd('x', -2.8, W, D), -3.0);
  // Mid value: grid snap
  assert.strictEqual(_snapEnd('x', 1.1, W, D),   1.0);
  // Beyond limit: clamped
  assert.strictEqual(_snapEnd('x', 5.0, W, D),   3.0);
  console.log('  _snapEnd ✓');

  // Snap is idempotent for already-snapped values
  for (const v of [-2.0, -1.75, -1.5, -1.0, -0.5, 0, 0.5, 1.0, 1.5, 2.0]) {
    assert.strictEqual(_snapToGrid(v), v, `idempotent at ${v}`);
  }
  console.log('  idempotency ✓');

  console.log('All snap tests passed!');
}

runTests();
