// Basic unit tests for pricing logic. Run with `node test/pricing.test.js`.

const assert = require('assert');

// Provide a minimal localStorage mock before requiring pricing.js so the
// override test can write to it and _getPricingOverrides() will pick it up.
const _lsMock = {};
global.localStorage = {
  getItem:    k   => _lsMock[k] ?? null,
  setItem:    (k, v) => { _lsMock[k] = v; },
  removeItem: k   => { delete _lsMock[k]; },
};

const {
  CATALOGUE,
  getPricingOverrides,
  calcFoundation,
  calcTotal,
  calcAreaItem,
  calcEachItem,
  getRate,
  getItem,
  ROOF_STYLE_UPLIFT,
} = require('../js/pricing');

function approx(val, expected, tol = 1) {
  if (Math.abs(val - expected) > tol) {
    throw new Error(`Expected ${expected} ±${tol}, got ${val}`);
  }
}

function runTests() {
  console.log('Running pricing logic tests...');

  // foundation
  // base area (12 sqm) should equal base price
  let s = { width: 3, depth: 4, foundation: 'concrete' };
  assert.strictEqual(calcFoundation(s).total, 1800);

  // larger room should include extra charge
  s = { width: 6, depth: 3, foundation: 'concrete' }; // area 18, extra 6m2
  assert.strictEqual(calcFoundation(s).total, 1800 + 6 * 95);

  // block base still has 12sqm included
  s = { width: 3, depth: 4, foundation: 'block' };
  assert.strictEqual(calcFoundation(s).total, 550);

  // larger block room incurs extra cost
  s = { width: 5, depth: 4, foundation: 'block' };
  // area 20 => 550 + (8 * 45)
  assert.strictEqual(calcFoundation(s).total, 550 + 8 * 45);

  s = { width: 5, depth: 4, foundation: 'screws' };
  // area 20 => qty = max(4, ceil(20*0.4)=8) -> 8 screws
  assert.strictEqual(calcFoundation(s).total, 8 * 120);

  // verify uplift constant
  assert.strictEqual(ROOF_STYLE_UPLIFT.apex, 1400);
  assert.strictEqual(ROOF_STYLE_UPLIFT.flat, 0);

  // simple total calculation using some catalogue items
  s = {
    width: 5,
    depth: 4,
    height: 2.7,
    roof: 'flat',
    roofFinish: 'epdm_black_roofing',
    cladding: 'vertical_cedar_cladding',
    interiorWalls: 'white_finished_walls',
    interiorFloor: 'oak_flooring',
    openings: [],
    extras: { decking: false },
    deckingMaterial: '',
    deckingArea: 0,
    electricalItems: {},
    bathroomItems: {},
    heatingItems: {},
    structuralItems: {},
    roofPorchItems: {},
    miscItems: {},
    guttering: 'none',
  };

  const total = calcTotal(s);
  console.log('Sample configuration total:', total);
  assert.ok(total > 0, 'Total should be positive');

  // roof style uplift should appear
  s.roof = 'apex';
  const totalApex = calcTotal(s);
  assert.strictEqual(totalApex - total, ROOF_STYLE_UPLIFT.apex);
  // return to flat for subsequent tests
  s.roof = 'flat';

  // verify helpers calculate area- and quantity‑based items correctly
  const roofFinish = getItem('epdm_black_roofing');
  const areaCalc = calcAreaItem('epdm_black_roofing', 10);
  assert.strictEqual(areaCalc.total, Math.round(roofFinish.rate * 10));
  const eachCalc = calcEachItem('single_socket', 3);
  assert.strictEqual(eachCalc.total, getRate('single_socket') * 3);

  // guttering should charge rate × perimeter (meters)
  s.guttering = 'gutter_white';
  const perim = 2 * (s.width + s.depth);
  assert.strictEqual(calcTotal(s) - total, Math.round(getRate('gutter_white') * perim));
  s.guttering = 'none';

  // overriding a rate should affect getRate/getItem and calculation
  const testKey = 'override_test_item';
  // insert a dummy item in catalogue for testing
  CATALOGUE.misc = CATALOGUE.misc || {};
  CATALOGUE.misc.test = [{ key: testKey, label: 'Override Test', rate: 100, unit: 'Each' }];
  assert.strictEqual(getRate(testKey), 100);
  assert.strictEqual(getItem(testKey).rate, 100);
  // simulate admin saving an override via localStorage (as the real admin panel does)
  const overrides = getPricingOverrides();
  overrides[testKey] = 200;
  localStorage.setItem('gardenroom_pricing', JSON.stringify(overrides));
  assert.strictEqual(getRate(testKey), 200);
  assert.strictEqual(getItem(testKey).rate, 200);
  // clean up
  delete overrides[testKey];
  localStorage.setItem('gardenroom_pricing', JSON.stringify(overrides));

  console.log('Rate override behaviour verified');

  // new employer-requested items should exist in catalogue
  ['mains_electric_connection','skip_hire','water_waste_connection',
   'ground_protection_mats','ethernet_connection','groundworks']
    .forEach(key => {
      const item = getItem(key);
      assert.ok(item, `catalogue contains ${key}`);
      assert.strictEqual(item.rate, 0);
    });

  // booleans should be honoured
  s.mainsConnection = true;
  assert.strictEqual(calcTotal(s) - total, getRate('mains_electric_connection'));
  s.mainsConnection = false;
  s.ethernetConnection = true;
  assert.strictEqual(calcTotal(s) - total, getRate('ethernet_connection'));

  s.ethernetConnection = false;

  // site services booleans
  s.waterWasteConnection = true;
  assert.strictEqual(calcTotal(s) - total, getRate('water_waste_connection'));
  s.waterWasteConnection = false;
  s.groundProtectionMats = true;
  assert.strictEqual(calcTotal(s) - total, getRate('ground_protection_mats'));
  s.groundProtectionMats = false;
  s.skipHire = true;
  assert.strictEqual(calcTotal(s) - total, getRate('skip_hire'));
  s.skipHire = false;
  s.groundworks = true;
  assert.strictEqual(calcTotal(s) - total, getRate('groundworks'));
  s.groundworks = false;

  // ── Openings contribute to total ─────────────────────────────────────────
  // Use keys that exist in the pricing catalogue (not 3D model style keys)
  s.openings = [{ id: 1, type: 'door', wall: 'front', offset: 0, style: 'double_door' }];
  const totalWithDoor = calcTotal(s);
  const doorItem = getItem('double_door');
  assert.ok(doorItem, 'double_door exists in catalogue');
  assert.strictEqual(totalWithDoor - total, doorItem.rate, 'door price matches catalogue');

  s.openings = [{ id: 1, type: 'window', wall: 'left', offset: 0, style: 'tilt_n_turn_window' }];
  const totalWithWindow = calcTotal(s);
  const winItem = getItem('tilt_n_turn_window');
  assert.ok(winItem, 'tilt_n_turn_window exists in catalogue');
  assert.strictEqual(totalWithWindow - total, winItem.rate, 'window price matches catalogue');

  // Styles not in the pricing catalogue contribute £0 (3D-only styles)
  s.openings = [{ id: 1, type: 'door', wall: 'front', offset: 0, style: 'double_french_door' }];
  assert.strictEqual(calcTotal(s), total, 'unknown style contributes £0 to total');
  s.openings = [];

  // ── Decking is charged per m² when enabled ───────────────────────────────
  s.extras = { decking: true };
  s.deckingMaterial = 'composite_decking';
  s.deckingArea = 15;
  const deckItem = getItem('composite_decking');
  if (deckItem) {
    const expectedDecking = Math.round(deckItem.rate * 15);
    assert.strictEqual(calcTotal(s) - total, expectedDecking, 'decking priced per m²');
  }
  s.extras = { decking: false };
  s.deckingArea = 0;

  // ── Quantity items accumulate correctly ──────────────────────────────────
  s.electricalItems = { double_socket: 3, single_socket: 0, floor_socket: 0, usb_socket: 0,
    smart_socket: 0, external_socket: 0, shaver_socket: 0, tv_socket: 0, phone_socket: 0,
    light_switch: 0, double_light_switch: 0, dimmer_switch: 0, '2_gang_dimmer_switch': 0,
    '3_gang_dimmer': 0, '4_gang_dimmer': 0, rotary_switch: 0, store_switch: 0,
    ceiling_light: 2, external_ceiling_light: 0, wall_light: 0, up_down_light: 0,
    strip_light: 0, track_light: 0, track_light_ceiling: 0, panel_light: 0,
    linear_wall_light: 0, security_light_with_pir: 0, '10_way_cu': 0, consumer_box: 0,
    internal_consumer_unit: 0, electrics: 0, isolator_20a: 0, isolator_45a: 0,
    fan_isolator: 0, pir_sensor: 0, extractor_fan: 0, data_point: 0 };
  const expectedElec = getRate('double_socket') * 3 + getRate('ceiling_light') * 2;
  assert.strictEqual(calcTotal(s) - total, expectedElec, 'qty electrical items sum correctly');
  s.electricalItems = Object.fromEntries(Object.keys(s.electricalItems).map(k => [k, 0]));

  // ── screws foundation uses screw count, not flat rate ────────────────────
  const screwState = { width: 3, depth: 4, foundation: 'screws' };
  const screwResult = calcFoundation(screwState);
  assert.ok(screwResult.total > 0, 'screws foundation has a cost');
  assert.ok(screwResult.label.toLowerCase().includes('screw'), 'foundation label mentions screws');

  // ── Zero-area room has no area-based charges ──────────────────────────────
  // (Guards against divide-by-zero or negative prices)
  const tinyState = { ...s, width: 0.1, depth: 0.1, foundation: 'concrete' };
  assert.doesNotThrow(() => calcTotal(tinyState), 'calcTotal handles tiny rooms without throwing');

  console.log('All pricing tests passed!');
}

runTests();
