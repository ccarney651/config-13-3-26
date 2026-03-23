// Structural tests for DEFAULT_STATE and state shape.
// Verifies all required keys exist, types are correct, and arrays are valid.
// Run with: node test/state.test.js

const assert = require('assert');

const path = require('path');
const { DEFAULT_STATE, state } = require(path.join(__dirname, '../js/state'));

function runTests() {
  console.log('Running state structure tests...');

  // ── DEFAULT_STATE exists and is a plain object ───────────────────────────
  assert.ok(typeof DEFAULT_STATE === 'object' && DEFAULT_STATE !== null, 'DEFAULT_STATE exists');

  // ── Required top-level keys ──────────────────────────────────────────────
  const requiredKeys = [
    'width', 'depth', 'height',
    'foundation', 'roof', 'roofTilt', 'roofFinish', 'apexPitch',
    'cladding', 'claddingTint', 'claddingPerWall',
    'frameColour', 'handleColour',
    'defaultDoor', 'defaultWindow', 'defaultDoorMat',
    'openings', 'nextOpeningId',
    'partitions', 'nextPartitionId',
    'presetRooms', 'nextPresetRoomId',
    'furniture', 'nextFurnitureId',
    'interiorWalls', 'interiorFloor',
    'guttering', 'extras',
    'deckingMaterial', 'deckingArea', 'deckingBalustrade',
    'mainsConnection', 'ethernetConnection', 'waterWasteConnection',
    'groundProtectionMats', 'skipHire', 'groundworks',
    'electricalItems', 'bathroomItems', 'heatingItems',
    'structuralItems', 'roofPorchItems', 'miscItems',
    'groundType', 'structureType', 'windowSillAdjust',
    'veranda', 'gutterColour', 'units',
  ];

  for (const key of requiredKeys) {
    assert.ok(key in DEFAULT_STATE, `DEFAULT_STATE has key: ${key}`);
  }
  console.log(`  All ${requiredKeys.length} required keys present ✓`);

  // ── Numeric dimensions are positive ─────────────────────────────────────
  assert.ok(DEFAULT_STATE.width  > 0, 'width > 0');
  assert.ok(DEFAULT_STATE.depth  > 0, 'depth > 0');
  assert.ok(DEFAULT_STATE.height > 0, 'height > 0');
  console.log('  Dimensions positive ✓');

  // ── Arrays are arrays ────────────────────────────────────────────────────
  assert.ok(Array.isArray(DEFAULT_STATE.openings),    'openings is array');
  assert.ok(Array.isArray(DEFAULT_STATE.partitions),  'partitions is array');
  assert.ok(Array.isArray(DEFAULT_STATE.presetRooms), 'presetRooms is array');
  assert.ok(Array.isArray(DEFAULT_STATE.furniture),   'furniture is array');
  console.log('  Array fields are arrays ✓');

  // ── nextId counters are greater than any existing id in their array ──────
  for (const op of DEFAULT_STATE.openings) {
    assert.ok(op.id < DEFAULT_STATE.nextOpeningId,
      `opening id ${op.id} < nextOpeningId ${DEFAULT_STATE.nextOpeningId}`);
  }
  for (const f of DEFAULT_STATE.furniture) {
    assert.ok(f.id < DEFAULT_STATE.nextFurnitureId,
      `furniture id ${f.id} < nextFurnitureId ${DEFAULT_STATE.nextFurnitureId}`);
  }
  for (const r of DEFAULT_STATE.presetRooms) {
    assert.ok(r.id < DEFAULT_STATE.nextPresetRoomId,
      `presetRoom id ${r.id} < nextPresetRoomId ${DEFAULT_STATE.nextPresetRoomId}`);
  }
  console.log('  nextId counters consistent ✓');

  // ── openings have required fields ────────────────────────────────────────
  for (const op of DEFAULT_STATE.openings) {
    assert.ok(typeof op.id     === 'number', `opening ${op.id}: id is number`);
    assert.ok(typeof op.type   === 'string', `opening ${op.id}: type is string`);
    assert.ok(typeof op.wall   === 'string', `opening ${op.id}: wall is string`);
    assert.ok(typeof op.offset === 'number', `opening ${op.id}: offset is number`);
    assert.ok(typeof op.style  === 'string', `opening ${op.id}: style is string`);
    assert.ok(['front','back','left','right'].includes(op.wall),
      `opening ${op.id}: wall is valid`);
    assert.ok(['door','window'].includes(op.type),
      `opening ${op.id}: type is door or window`);
  }
  console.log(`  ${DEFAULT_STATE.openings.length} openings all valid ✓`);

  // ── claddingPerWall has all four walls ───────────────────────────────────
  for (const wall of ['front','back','left','right']) {
    assert.ok(wall in DEFAULT_STATE.claddingPerWall, `claddingPerWall.${wall} exists`);
  }
  console.log('  claddingPerWall structure ✓');

  // ── All quantity item objects exist and contain only numbers ─────────────
  const qtyGroups = ['electricalItems','bathroomItems','heatingItems','structuralItems','roofPorchItems','miscItems'];
  for (const group of qtyGroups) {
    assert.ok(typeof DEFAULT_STATE[group] === 'object', `${group} is object`);
    for (const [k, v] of Object.entries(DEFAULT_STATE[group])) {
      assert.ok(typeof v === 'number', `${group}.${k} is number`);
      assert.ok(v >= 0, `${group}.${k} >= 0`);
    }
  }
  console.log('  Quantity item groups all valid ✓');

  // ── state is a deep clone of DEFAULT_STATE (not same reference) ──────────
  assert.ok(state !== DEFAULT_STATE, 'state is not same reference as DEFAULT_STATE');
  assert.ok(state.openings !== DEFAULT_STATE.openings, 'state.openings is a separate array');
  assert.strictEqual(state.width, DEFAULT_STATE.width, 'state.width matches default');
  console.log('  state is a deep clone of DEFAULT_STATE ✓');

  // ── veranda sub-object ───────────────────────────────────────────────────
  assert.ok(typeof DEFAULT_STATE.veranda === 'object',        'veranda is object');
  assert.ok(typeof DEFAULT_STATE.veranda.depth === 'number',  'veranda.depth is number');
  assert.ok(DEFAULT_STATE.veranda.depth > 0,                  'veranda.depth > 0');
  console.log('  veranda structure ✓');

  console.log('\nAll state tests passed!');
}

runTests();
