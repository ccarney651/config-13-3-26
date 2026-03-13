# Garden Room Configurator — Project Brief

## What this is
A customer-facing 3D configurator and pricing tool for a garden room manufacturer based in Northern Ireland. Customers use it to design a garden room and get an accurate price estimate. It runs entirely in the browser as a local HTML/JS/CSS project — no backend, no build step.

## How to run it
```bash
npx serve .
# or: npm start (if package.json is set up)
```
Open http://localhost:3000 in a browser.

## File structure
```
configurator/
├── index.html        — markup only, all logic is in separate JS files
├── css/
│   └── style.css     — all styles
├── js/
│   ├── state.js      — single source of truth for current configuration values
│   ├── pricing.js    — ALL pricing rules and calculators (edit prices here)
│   ├── scene.js      — Three.js 3D scene, building geometry, GLB model loading
│   ├── ui.js         — event handlers wiring UI to state + pricing
│   ├── leads.js      — lead capture modal; stores leadInfo, builds mailto enquiry
│   └── quote.js      — quote modal builder, reads from pricing.js functions
└── assets/           — textures (.jpg) and 3D models (.glb), sensibly named
```

## Pricing rules (from employer spec)
All prices in `pricing.js`. Key rules:
- **Foundation**: Concrete £1,800 / Block £550 / Ground Screws £120/screw — all include 12m² base area, extra area charged per m²
- **Doors**: Single French £850 / Double French £1,600 / Bi-Fold £3,500 / Sliding £2,800
  - Bi-fold carries +70% uplift on base price
  - PVC material carries +20% on final door price
- **Roof styles**: Flat included / Apex +£1,400
- **Roof finishes**: EPDM included / Grey Shingle +£400 / Red Shingle +£400 / Green Roof +£1,200 / Pebble +£350 / Cedar Shingle +£600
- **Cladding**: Timber included / Composite +£700 / Render +£500 / Cedar +£950
- **Reinforcement**: Floor £65/m² / Walls £75/m² (wall area = perimeter × height) / Ceiling £60/m²
- **Electrical**: CAT6 £250/point / Stove Flue £2,800 / Fire Boarding £140 / Log Fire £795 / Radiator £249
- **Lighting**: Internal spotlights £65/each / External downlights £129/each
- **Decking**: £95/m²
- **Roof lantern**: £2,200
- **Window style uplifts**: Long Panel +£200 / Narrow Vertical +£150 / Narrow Horizontal +£150 — NOTE: these are placeholder figures, not confirmed by employer yet
- **Payment terms**: 50% deposit / 40% at manufacture start / 10% on completion

## Admin → configurator wiring
- `pricing.js` loads `gardenroom_pricing` from localStorage at startup. `getItem(key)` returns a copy of the item with the admin-overridden rate already applied, so all price calculations automatically use the current admin prices.
- `pricing.js` loads `gardenroom_disabled` from localStorage. `isItemEnabled(key)` checks this.
- `ui.js` runs `applyAdminDisabledItems()` on page load, which hides any `[data-key]` element on the customer side whose key is in the disabled list.
- Admin panel must be on the same domain/origin as the configurator for localStorage sharing to work. On GitHub Pages this is automatic since both are served from the same site.

## Admin panel image thumbnails
Each item row in admin.html shows a 40×32px thumbnail. The image is loaded from:
  `assets/{item.key}.jpg`
For example, `assets/vertical_shiplap_cladding.jpg`.
- If the file exists in the repo, it displays automatically — no config needed.
- If not, a grey placeholder with an image icon is shown instead.
- Images should be roughly square crops, min 80×80px recommended.
- Hover the thumbnail to see the expected filename in the tooltip.

## 3D models
All GLB files are in `assets/`. They are real-world scaled (1 unit = 1 metre) with origins at bottom-left corner.

| File | Natural width | Notes |
|------|--------------|-------|
| door_french.glb | 1.6m | Used for single (scaled to 0.9m) and double (scaled to 1.8m) |
| door_bifold.glb | 2.4m | Used for bi-fold |
| door_sliding.glb | 2.4m | Used for sliding/patio |
| win_tilt.glb | 0.9m × 1.2m | Tilt & Turn |
| win_long.glb | 0.971m × 2.1m | Long panel |
| win_vert.glb | 0.4m × 1.2m | Narrow vertical |
| win_horiz.glb | 1.2m × 0.4m | Narrow horizontal |

Models are loaded via `loadModel(filePath)` in scene.js using `GLTFLoader.load()` with local file paths. Caching is handled automatically.

## Running tests
```bash
node test/pricing.test.js
```
Covers foundation pricing, roof uplifts, guttering, rate overrides, and service boolean toggles.

## Known issues / things still to fix
- Window placement positions (left/right wall) need visual verification
- Not fully mobile responsive (basic touch/scroll works, but layout is desktop-first)

## Employer confirmations needed (TODOs in pricing.js)
The following catalogue items were deduplicated but their correct size brackets or rates
need sign-off before the `_v2`/`_v3` suffixes can be replaced with meaningful names:
- `bathroom` (£3000 full suite) vs `bathroom_v2` (£80 — unclear what this represents)
- `electric_shower` (£160 standard) vs `electric_shower_v2` (£180 premium)
- `sliding_4_part_door` (£5200) vs `sliding_4_part_door_v2` (£4000)
- `stacker_door` (£3100) vs `stacker_door_v2` (£3500)
- `roof_window` / `roof_window_v2` / `roof_window_v3` (£1800 / £2000 / £2500 — Small/Medium/Large assumed)
- `awning_window` / `_v2` / `_v3` (£300 / £500 / £800)
- `awning_vertical_window` / `_v2` (£507 / £800)
- `fixed_window` / `_v2` / `_v3` (£900 / £300 / £500)
- `tilt_n_turn_window` / `_v2` (£250 / £350)
- Window style price uplifts (Long Panel +£200, Narrow Vertical/Horizontal +£150) are placeholder figures

## Recent fixes (v6.1 session)
- **`setActivePalette` double-definition** — the empty stub in `ui.js` was shadowing the real
  implementation in `scene.js`, silently breaking door/window placement. Stub removed.
- **`makeRoofMat()` no-args call** — veranda roof panel now passes correct panel dimensions.
- **Camera debug overlay** — `#camDebug` element, CSS rule, and JS write all removed.
- **Stale GLB injection** — added `_buildGen` counter; async GLB callbacks bail out if their
  build generation no longer matches, preventing models from a previous build appearing in
  a freshly rebuilt scene when sliders are dragged quickly.
- **Catalogue duplicates** — 16 duplicate keys reduced to 0. Exact-same-rate dupes deleted;
  different-rate dupes suffixed `_v2`/`_v3` with TODO comments for employer confirmation.
- **Roof window HTML bug** — three qty items all shared `id="qty-roof_window"` and wrote to
  the same state key; now use distinct keys `roof_window` / `roof_window_v2` / `roof_window_v3`
  with matching state entries and labels (Small / Medium / Large).

## Architecture decisions
- No framework, no build step — plain HTML/JS/CSS so non-developers can open and edit it easily
- Three.js r128 loaded from CDN (cdnjs.cloudflare.com)
- GLTFLoader loaded from CDN (cdn.jsdelivr.net)
- All state lives in `state.js` — UI writes to state, pricing and scene read from state
- `buildRoom()` in scene.js is called whenever any visual option changes
- `updatePriceDisplay()` in ui.js is called whenever any pricing option changes
- Quote modal is generated fresh each time it opens from current state

## Context
- Developer is a trainee (Development & Automation role) at a multi-brand garden/outdoor products company in Northern Ireland
- This is an internal project being built incrementally alongside other responsibilities
- Eventually intended to be embedded on a customer-facing website
- Pricing engine accuracy is the current top priority over 3D visual quality
