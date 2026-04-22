/**
 * quote.js — Builds and opens the quote summary modal.
 * Updated to use CATALOGUE-based pricing.
 */

function printQuote() {
  const total     = calcTotal(state);
  const deposit   = Math.round(total * 0.50);
  const midStage  = Math.round(total * 0.40);
  const completion= Math.round(total * 0.10);
  const s = state;
  const area = s.width * s.depth;
  const subtitle = typeof leadInfo !== 'undefined' && leadInfo.name
    ? `Prepared for ${leadInfo.name}`
    : 'Indicative estimate';
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const win = window.open('', '_blank', 'width=820,height=900');
  if (!win) { alert('Please allow pop-ups for this page to download the PDF.'); return; }

  win.document.write(`<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<title>Garden Room Quotation</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #1a1a1a; background: #fff; padding: 0; }
  @page { size: A4; margin: 18mm 16mm; }

  /* ── Header ── */
  .hd { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #274833; padding-bottom: 12px; margin-bottom: 22px; }
  .hd-brand { font-size: 22px; font-weight: 700; color: #274833; letter-spacing: -0.5px; }
  .hd-brand span { font-size: 12px; font-weight: 400; color: #555; display: block; margin-top: 2px; }
  .hd-meta { text-align: right; font-size: 12px; color: #555; line-height: 1.7; }
  .hd-meta strong { color: #1a1a1a; }

  /* ── Spec strip ── */
  .spec-strip { display: flex; gap: 0; border: 1px solid #d0d0d0; border-radius: 6px; overflow: hidden; margin-bottom: 24px; }
  .spec-cell { flex: 1; padding: 10px 14px; border-right: 1px solid #d0d0d0; }
  .spec-cell:last-child { border-right: none; }
  .spec-cell .lbl { font-size: 10px; color: #777; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px; }
  .spec-cell .val { font-size: 14px; font-weight: 600; color: #274833; }

  /* ── Sections ── */
  .q-section { margin-bottom: 16px; break-inside: avoid; page-break-inside: avoid; }
  .q-section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #274833; border-bottom: 1px solid #c8dbc8; padding-bottom: 5px; margin-bottom: 6px; }
  .q-line { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #f0f0f0; font-size: 12.5px; }
  .q-line:last-child { border-bottom: none; }
  .q-line.sub { padding-left: 14px; color: #555; font-size: 12px; }
  .q-line span:last-child { font-weight: 500; white-space: nowrap; margin-left: 12px; }
  .q-note { font-size: 11.5px; color: #666; padding: 3px 0; line-height: 1.5; }

  /* ── Total ── */
  .total-box { border-top: 2px solid #274833; margin-top: 24px; padding-top: 14px; break-inside: avoid; }
  .total-row { display: flex; justify-content: space-between; align-items: baseline; }
  .total-label { font-size: 14px; font-weight: 600; }
  .total-price { font-size: 26px; font-weight: 700; color: #274833; }
  .vat-note { font-size: 11px; color: #888; margin-top: 2px; }

  /* ── Payment stages ── */
  .stages { display: flex; gap: 12px; margin-top: 16px; }
  .stage { flex: 1; background: #f3f7f3; border: 1px solid #c8dbc8; border-radius: 6px; padding: 10px 14px; text-align: center; }
  .stage .pct { font-size: 18px; font-weight: 700; color: #274833; }
  .stage .plbl { font-size: 10px; color: #555; margin-top: 2px; }
  .stage .pamt { font-size: 13px; font-weight: 600; margin-top: 4px; }

  /* ── Footer ── */
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e0e0e0; font-size: 10.5px; color: #888; line-height: 1.6; }
  .footer strong { color: #555; }
</style>
</head><body>

<div class="hd">
  <div class="hd-brand">Garden Rooms
    <span>Quality Garden Buildings · Northern Ireland</span>
  </div>
  <div class="hd-meta">
    <strong>Quotation Reference</strong><br>
    Date: ${date}<br>
    ${subtitle}
  </div>
</div>

<div class="spec-strip">
  <div class="spec-cell"><div class="lbl">Size</div><div class="val">${s.width}m × ${s.depth}m × ${s.height}m</div></div>
  <div class="spec-cell"><div class="lbl">Floor Area</div><div class="val">${area}m²</div></div>
  <div class="spec-cell"><div class="lbl">Roof</div><div class="val">${s.roof === 'apex' ? 'Apex' : 'Flat'}</div></div>
  <div class="spec-cell"><div class="lbl">Foundation</div><div class="val">${s.foundation.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</div></div>
</div>

${buildQuoteHTML()}

<div class="total-box">
  <div class="total-row">
    <span class="total-label">Total Estimate</span>
    <span class="total-price">${fmt(total)}</span>
  </div>
  <div class="vat-note">All prices exclude VAT · Indicative only · Subject to site survey and final specification</div>

  <div class="stages">
    <div class="stage"><div class="pct">50%</div><div class="plbl">Deposit on order</div><div class="pamt">${fmt(deposit)}</div></div>
    <div class="stage"><div class="pct">40%</div><div class="plbl">At manufacture start</div><div class="pamt">${fmt(midStage)}</div></div>
    <div class="stage"><div class="pct">10%</div><div class="plbl">On completion</div><div class="pamt">${fmt(completion)}</div></div>
  </div>
</div>

<div class="footer">
  <strong>Important:</strong> This quotation is indicative and subject to a site survey, planning assessment, and final specification agreement.
  Prices are valid for 30 days from the date above. A signed variation form is required for any amendments to an agreed specification.
  External plumbing, electrical connections, and groundworks beyond the building footprint are excluded unless explicitly itemised above.
</div>

</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 400);
}

function openQuoteModal() {
  const body = document.getElementById('modalBody');
  body.innerHTML = buildQuoteHTML();
  document.getElementById('quoteTotal').textContent = fmt(calcTotal(state));

  const subtitle = document.getElementById('quoteSubtitle');
  subtitle.textContent = typeof leadInfo !== 'undefined' && leadInfo.name
    ? `Prepared for ${leadInfo.name} · Indicative pricing · subject to site survey`
    : 'Indicative pricing · subject to site survey and final specification';

  document.getElementById('modal').classList.add('open');
}

function closeQuoteModal() {
  document.getElementById('modal').classList.remove('open');
}

function qLine(label, cost, isSubItem) {
  const priceStr = typeof cost === 'number' ? fmt(cost) : cost;
  const cls = isSubItem ? 'q-line sub' : 'q-line';
  return `<div class="${cls}"><span>${label}</span><span>${priceStr}</span></div>`;
}

function qSection(title, lines) {
  if (!lines || lines.length === 0) return '';
  return `<div class="q-section"><div class="q-section-title">${title}</div>${lines.join('')}</div>`;
}

function buildQuoteHTML() {
  const s = state;
  const area = s.width * s.depth;
  const wallArea = 2 * (s.width + s.depth) * s.height;
  let html = '';

  // ─── Dimensions ─────────────────────────────────────────────────────────
  html += qSection('Building Dimensions', [
    qLine(`${fmtDim(s.width)} × ${fmtDim(s.depth)} × ${fmtDim(s.height)} (${fmtArea(area)})`, 'See below'),
  ]);

  // ─── Foundation ─────────────────────────────────────────────────────────
  const found = calcFoundation(s);
  html += qSection('Foundation', [qLine(`${found.label} — ${found.detail}`, found.total)]);

  // ─── Roofing ────────────────────────────────────────────────────────────
  if (s.roofFinish) {
    const r = getItem(s.roofFinish);
    if (r) html += qSection('Roofing', [qLine(`${r.label} (${fmtArea(area)} × £${r.rate})`, Math.round(r.rate * area))]);
  }

  // ─── Cladding ───────────────────────────────────────────────────────────
  if (s.cladding) {
    const c = getItem(s.cladding);
    if (c) html += qSection('Cladding', [qLine(`${c.label} (${fmtArea(wallArea)} × £${c.rate})`, Math.round(c.rate * wallArea))]);
  }

  // ─── Openings ───────────────────────────────────────────────────────────
  if (s.openings.length > 0) {
    const lines = s.openings.map(op => {
      const item = getItem(op.style);
      const label = item ? `${item.label} (${op.wall})` : `${op.style} (${op.wall})`;
      return qLine(label, item ? item.rate : 0);
    });
    html += qSection('Doors & Windows', lines);
  }

  // ─── Interior ───────────────────────────────────────────────────────────
  const intLines = [];
  if (s.interiorWalls) {
    const w = getItem(s.interiorWalls);
    if (w && w.rate > 0) intLines.push(qLine(`Walls: ${w.label} (${fmtArea(wallArea)} × £${w.rate})`, Math.round(w.rate * wallArea)));
  }
  if (s.interiorFloor) {
    const f = getItem(s.interiorFloor);
    if (f && f.rate > 0) intLines.push(qLine(`Floor: ${f.label} (${fmtArea(area)} × £${f.rate})`, Math.round(f.rate * area)));
  }
  html += qSection('Interior Finishes', intLines);

  // ─── Guttering ──────────────────────────────────────────────────────────
  if (s.guttering && s.guttering !== 'none') {
    const g = getItem(s.guttering);
    const perim = 2 * (s.width + s.depth);
    if (g) html += qSection('Guttering', [qLine(`${g.label} (${fmtDim(perim)} × £${g.rate})`, Math.round(g.rate * perim))]);
  }

  // ─── Decking ────────────────────────────────────────────────────────────
  if (s.extras.decking && s.deckingMaterial) {
    const d = getItem(s.deckingMaterial);
    if (d) html += qSection('Decking', [qLine(`${d.label} (${fmtArea(s.deckingArea)} × £${d.rate})`, Math.round(d.rate * s.deckingArea))]);
  }

  // ─── Quantity-based sections ────────────────────────────────────────────
  function qtySection(title, stateKey) {
    if (!s[stateKey]) return '';
    const lines = [];
    Object.entries(s[stateKey]).forEach(([key, qty]) => {
      if (qty > 0) {
        const item = getItem(key);
        if (item) {
          const cost = Math.round(item.rate * qty);
          const detail = qty > 1 ? `${qty} × £${item.rate}` : '';
          lines.push(qLine(`${item.label}${detail ? ' (' + detail + ')' : ''}`, cost));
        }
      }
    });
    return qSection(title, lines);
  }

  html += qtySection('Lighting & Electrics', 'electricalItems');
  html += qtySection('Bathroom & Fixtures', 'bathroomItems');
  html += qtySection('Heating & Climate', 'heatingItems');
  html += qtySection('Structural', 'structuralItems');
  html += qtySection('Roof & Porch Extras', 'roofPorchItems');
  html += qtySection('Accessories', 'miscItems');

  // ─── Service connection booleans ────────────────────────────────────────
  const elecSvcLines = [];
  if (s.mainsConnection)    elecSvcLines.push(qLine('Mains electric connection', getRate('mains_electric_connection')));
  if (s.ethernetConnection) elecSvcLines.push(qLine('Ethernet connection', getRate('ethernet_connection')));
  if (elecSvcLines.length)  html += qSection('Electrical Services', elecSvcLines);

  const siteSvcLines = [];
  if (s.waterWasteConnection) siteSvcLines.push(qLine('Water & waste connection', getRate('water_waste_connection')));
  if (s.groundProtectionMats) siteSvcLines.push(qLine('Ground protection mats', getRate('ground_protection_mats')));
  if (s.skipHire)             siteSvcLines.push(qLine('Skip hire', getRate('skip_hire')));
  if (s.groundworks)          siteSvcLines.push(qLine('Groundworks', getRate('groundworks')));
  if (siteSvcLines.length)    html += qSection('Groundworks & Utility', siteSvcLines);

  // ─── Roof style uplift ──────────────────────────────────────────────────
  if (s.roof === 'apex') {
    html += qSection('Roof Style', [qLine('Apex roof (structural premium)', ROOF_STYLE_UPLIFT.apex)]);
  }

  // ─── Exclusions ─────────────────────────────────────────────────────────
  html += `<div class="q-section">
    <div class="q-section-title">Exclusions & Notes</div>
    <div class="q-note">Plumbing and electrics external to the building are excluded.</div>
    <div class="q-note">Final service connections are subject to site survey and quotation.</div>
    <div class="q-note">A variation form must be completed for any amendments to the agreed specification.</div>
  </div>`;

  return html;
}
