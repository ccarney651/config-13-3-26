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


  console.log('All pricing tests passed!');
}

runTests();
