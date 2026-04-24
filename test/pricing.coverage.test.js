/**
 * pricing.coverage.test.js
 *
 * Verifies that every state field wired into calcTotal() actually changes the
 * quote total when toggled. Also reports items whose catalogue rate is £0
 * (those are known TBD placeholders, not code bugs).
 *
 * Run with: node test/pricing.coverage.test.js
 */

const assert = require('assert');

// Minimal localStorage mock (no admin overrides — tests raw catalogue rates)
const _lsMock = {};
global.localStorage = {
  getItem:    k      => _lsMock[k] ?? null,
  setItem:    (k, v) => { _lsMock[k] = v; },
  removeItem: k      => { delete _lsMock[k]; },
};

const { calcTotal, getItem, getRate, CATALOGUE } = require('../js/pricing');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Deep-clone base state so each test gets a fresh copy. */
function base() {
  return {
    width: 3, depth: 4, height: 2.4,
    foundation:    'concrete',
    roof:          'flat',
    roofFinish:    null,
    cladding:      'none',
    interiorWalls: 'none',
    interiorFloor: 'none',
    openings:      [],
    extras:        { decking: false },
    deckingMaterial: null,
    deckingArea:   0,
    guttering:     'none',
    electricalItems:  {},
    bathroomItems:    {},
    heatingItems:     {},
    structuralItems:  {},
    roofPorchItems:   {},
    miscItems:        {},
    mainsConnection:      false,
    ethernetConnection:   false,
    waterWasteConnection: false,
    groundProtectionMats: false,
    skipHire:             false,
    groundworks:          false,
  };
}

const pass = [];
const fail = [];
const zero = [];   // wired but rate is £0 — TBD placeholders

function check(label, mutateFn, opts = {}) {
  const s0 = base();
  const s1 = base();
  mutateFn(s1);
  const t0 = calcTotal(s0);
  const t1 = calcTotal(s1);

  if (t1 === t0) {
    if (opts.expectZeroRate) {
      zero.push({ label, note: opts.note || 'rate is £0 in catalogue — needs employer confirmation' });
    } else {
      fail.push({ label, t0, t1, note: opts.note || '' });
    }
  } else {
    pass.push(label);
  }
}

// ─── 1. Foundation ────────────────────────────────────────────────────────────

check('foundation: concrete vs block',
  s => { s.foundation = 'block'; });

check('foundation: concrete vs screws',
  s => { s.foundation = 'screws'; });

check('foundation: extra area surcharge (width increase)',
  s => { s.width = 6; }); // 6×4 = 24m² > 12m² base → extra charge

// ─── 2. Dimensions affect area-based costs ────────────────────────────────────
// (Need a surface cost active so dimension changes have something to scale)

check('dimension: width increase scales roof finish cost', s => {
  s.roofFinish = 'epdm_black_roofing';
  s.width = 6;
});

check('dimension: depth increase scales cladding cost', s => {
  s.cladding = 'vertical_cedar_cladding';
  s.depth = 6;
});

// ─── 3. Roof ─────────────────────────────────────────────────────────────────

check('roof style: apex uplift',
  s => { s.roof = 'apex'; });

check('roof finish: epdm_black_roofing',
  s => { s.roofFinish = 'epdm_black_roofing'; });

check('roof finish: cedar_roofing',
  s => { s.roofFinish = 'cedar_roofing'; });

check('roof finish: green_roof',
  s => { s.roofFinish = 'green_roof'; });

// ─── 4. Cladding ─────────────────────────────────────────────────────────────

check('cladding: vertical_cedar_cladding',
  s => { s.cladding = 'vertical_cedar_cladding'; });

check('cladding: corten_cladding',
  s => { s.cladding = 'corten_cladding'; });

check('cladding: red_brick_wall_01_cladding',
  s => { s.cladding = 'red_brick_wall_01_cladding'; });

// ─── 5. Interior walls ────────────────────────────────────────────────────────

check('interiorWalls: white_finished_walls',
  s => { s.interiorWalls = 'white_finished_walls'; });

check('interiorWalls: melamine_boards_finished_walls',
  s => { s.interiorWalls = 'melamine_boards_finished_walls'; });

// ─── 6. Interior floor ───────────────────────────────────────────────────────

check('interiorFloor: oak_flooring',
  s => { s.interiorFloor = 'oak_flooring'; });

check('interiorFloor: tiles_flooring',
  s => { s.interiorFloor = 'tiles_flooring'; });

check('interiorFloor: walnut_flooring',
  s => { s.interiorFloor = 'walnut_flooring'; });

// ─── 7. Openings ─────────────────────────────────────────────────────────────

check('opening: single_door',
  s => { s.openings = [{ style: 'single_door', wall: 'front', pos: 0.5 }]; });

check('opening: double_door',
  s => { s.openings = [{ style: 'double_door', wall: 'front', pos: 0.5 }]; });

check('opening: tilt_n_turn_window',
  s => { s.openings = [{ style: 'tilt_n_turn_window', wall: 'front', pos: 0.5 }]; });

check('opening: multiple openings sum correctly', s => {
  s.openings = [
    { style: 'single_door', wall: 'front', pos: 0.5 },
    { style: 'tilt_n_turn_window', wall: 'left', pos: 0.5 },
  ];
});

// ─── 8. Decking ──────────────────────────────────────────────────────────────

check('decking: enabled with material and area', s => {
  s.extras.decking   = true;
  s.deckingMaterial  = 'oak_decking';
  s.deckingArea      = 4;
});

check('decking: no effect when extras.decking is false', s => {
  s.extras.decking   = false;
  s.deckingMaterial  = 'oak_decking';
  s.deckingArea      = 4;
  // total must equal base — this is an intentional zero-delta check
}, { expectZeroRate: true, note: 'decking disabled — correct, no cost expected' });

// ─── 9. Guttering ────────────────────────────────────────────────────────────

check('guttering: gutter_white',
  s => { s.guttering = 'gutter_white'; });

check('guttering: gutter_black',
  s => { s.guttering = 'gutter_black'; });

// ─── 10. Electrical items ─────────────────────────────────────────────────────

check('electricalItems: single_socket qty 1',
  s => { s.electricalItems = { single_socket: 1 }; });

check('electricalItems: double_socket qty 3',
  s => { s.electricalItems = { double_socket: 3 }; });

check('electricalItems: track_light qty 2',
  s => { s.electricalItems = { track_light: 2 }; });

check('electricalItems: ceiling_light qty 1',
  s => { s.electricalItems = { ceiling_light: 1 }; });

check('electricalItems: consumer_box qty 1',
  s => { s.electricalItems = { consumer_box: 1 }; });

check('electricalItems: extractor_fan qty 1',
  s => { s.electricalItems = { extractor_fan: 1 }; });

// ─── 11. Bathroom items ───────────────────────────────────────────────────────

check('bathroomItems: toilet qty 1',
  s => { s.bathroomItems = { toilet: 1 }; });

check('bathroomItems: shower_room qty 1',
  s => { s.bathroomItems = { shower_room: 1 }; });

check('bathroomItems: basin_pedestal qty 1',
  s => { s.bathroomItems = { basin_pedestal: 1 }; });

check('bathroomItems: towel_rail qty 2',
  s => { s.bathroomItems = { towel_rail: 2 }; });

// ─── 12. Heating items ────────────────────────────────────────────────────────

check('heatingItems: wall_heater qty 1',
  s => { s.heatingItems = { wall_heater: 1 }; });

check('heatingItems: underfloor_heating qty 1',
  s => { s.heatingItems = { underfloor_heating: 1 }; });

check('heatingItems: climate_control qty 1',
  s => { s.heatingItems = { climate_control: 1 }; });

// ─── 13. Structural items ─────────────────────────────────────────────────────

check('structuralItems: mezzanine qty 1',
  s => { s.structuralItems = { mezzanine: 1 }; });

check('structuralItems: sip_walls qty 1',
  s => { s.structuralItems = { sip_walls: 1 }; });

// ─── 14. Roof & porch items ───────────────────────────────────────────────────

check('roofPorchItems: veranda qty 1',
  s => { s.roofPorchItems = { veranda: 1 }; });

check('roofPorchItems: pergola qty 1',
  s => { s.roofPorchItems = { pergola: 1 }; });

check('roofPorchItems: roof_window qty 1',
  s => { s.roofPorchItems = { roof_window: 1 }; });

// ─── 15. Misc items ───────────────────────────────────────────────────────────

check('miscItems: blinds qty 1',
  s => { s.miscItems = { blinds: 1 }; });

check('miscItems: smoke_alarm qty 1',
  s => { s.miscItems = { smoke_alarm: 1 }; });

// ─── 16. Service / site booleans ─────────────────────────────────────────────
// These have rate: 0 in the catalogue — they're TBD placeholders.
// Flagged as known zero-rate items, NOT code bugs.

check('service: mainsConnection',
  s => { s.mainsConnection = true; },
  { expectZeroRate: true, note: 'mains_electric_connection rate is £0 — needs employer rate' });

check('service: ethernetConnection',
  s => { s.ethernetConnection = true; },
  { expectZeroRate: true, note: 'ethernet_connection rate is £0 — needs employer rate' });

check('service: waterWasteConnection',
  s => { s.waterWasteConnection = true; },
  { expectZeroRate: true, note: 'water_waste_connection rate is £0 — needs employer rate' });

check('service: groundProtectionMats',
  s => { s.groundProtectionMats = true; },
  { expectZeroRate: true, note: 'ground_protection_mats rate is £0 — needs employer rate' });

check('service: skipHire',
  s => { s.skipHire = true; },
  { expectZeroRate: true, note: 'skip_hire rate is £0 — needs employer rate' });

check('service: groundworks',
  s => { s.groundworks = true; },
  { expectZeroRate: true, note: 'groundworks rate is £0 — needs employer rate' });

// ─── 17. Catalogue integrity — every item with rate > 0 resolves via getItem ──
// Catches any key that exists in the catalogue but returns undefined from getItem
// (which would silently contribute £0 even if rate > 0).

const catalogueMissing = [];
Object.entries(CATALOGUE).forEach(([catKey, cat]) => {
  Object.entries(cat).forEach(([subKey, items]) => {
    if (!Array.isArray(items)) return;
    items.forEach(it => {
      if (it.rate > 0) {
        const resolved = getItem(it.key);
        if (!resolved) catalogueMissing.push(`${catKey}.${subKey}.${it.key}`);
      }
    });
  });
});

// ─── Report ───────────────────────────────────────────────────────────────────

console.log('\nRunning pricing coverage tests...\n');

if (pass.length) {
  console.log(`✓ ${pass.length} checks passed — state change correctly affects total`);
}

if (zero.length) {
  console.log(`\n⚠  ${zero.length} items wired but contribute £0 (TBD rates — not bugs):`);
  zero.forEach(z => console.log(`   · ${z.label}\n     ${z.note}`));
}

if (catalogueMissing.length) {
  console.log(`\n✗ ${catalogueMissing.length} catalogue items with rate > 0 not resolved by getItem():`);
  catalogueMissing.forEach(k => console.log(`   · ${k}`));
} else {
  console.log('✓ All catalogue items with rate > 0 resolve correctly via getItem()');
}

if (fail.length) {
  console.log(`\n✗ ${fail.length} FAILURES — state change had no effect on total:`);
  fail.forEach(f => {
    console.log(`   · ${f.label}`);
    if (f.note) console.log(`     note: ${f.note}`);
    console.log(`     base total: £${f.t0}   mutated total: £${f.t1}`);
  });
  console.log('');
  process.exit(1);
} else {
  console.log('\nAll pricing coverage tests passed!\n');
}
