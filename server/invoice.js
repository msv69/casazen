// Fattura stampabile (A4) con polizza di versamento QR svizzera
const { SwissQRBill } = require('swissqrbill/svg');
const { isQRIBAN, calculateQRReferenceChecksum } = require('swissqrbill/utils');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const chf = (n) => Number(n || 0).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (s) => (s ? s.split('-').reverse().join('.') : '');

function qrBill(inv, d) {
  const p = d.property || {};
  const iban = String(p.iban || '').replace(/\s/g, '');
  const balance = Math.round((d.total - (d.paid || 0)) * 100) / 100;
  if (!iban || balance <= 0 || !p.name || !p.zip || !p.city) return '';
  const b = d.booking;
  const data = {
    currency: 'CHF', amount: balance,
    creditor: { name: p.name, address: p.address || '-', zip: p.zip, city: p.city, account: iban, country: p.country || 'CH' },
    message: `Fattura ${inv.number}`,
  };
  if (b.last_name && b.zip && b.city) {
    data.debtor = { name: `${b.first_name || ''} ${b.last_name}`.trim(), address: b.address || '-', zip: b.zip, city: b.city, country: /^[A-Za-z]{2}$/.test(b.country || '') ? b.country.toUpperCase() : 'CH' };
  }
  try {
    if (isQRIBAN(iban)) {
      const base = String(inv.number).replace(/\D/g, '').padStart(26, '0').slice(-26);
      data.reference = base + calculateQRReferenceChecksum(base);
    }
    return new SwissQRBill(data, { language: 'IT' }).toString();
  } catch (e) {
    return `<p class="qr-error">Polizza QR non generata: ${esc(e.message)}. Controlla IBAN e indirizzo nelle impostazioni.</p>`;
  }
}

function renderInvoice(inv, d) {
  const p = d.property || {};
  const b = d.booking;
  const qr = qrBill(inv, d);
  const due = new Date(new Date(inv.date).getTime() + (d.payment_days || 10) * 86400000).toISOString().slice(0, 10);
  const balance = d.total - (d.paid || 0);
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Fattura ${esc(inv.number)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700&display=swap" rel="stylesheet">
<style>
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; background: #e9ece9; font-family: Archivo, Arial, sans-serif; color: #263033; font-size: 10.5pt; font-variant-numeric: tabular-nums; }
.page { width: 210mm; min-height: 297mm; margin: 12px auto; background: #fff; display: flex; flex-direction: column; }
.content { padding: 18mm 18mm 8mm; }
.head { display: flex; justify-content: space-between; align-items: flex-start; }
.brand { font-weight: 700; font-size: 15pt; color: #1F5B6E; }
.small { color: #5b676b; font-size: 9pt; line-height: 1.45; }
.addr { margin: 16mm 0 0 100mm; line-height: 1.45; min-height: 26mm; }
h1 { font-size: 15pt; margin: 10mm 0 2mm; }
.meta { display: grid; grid-template-columns: auto 1fr; gap: 1mm 6mm; font-size: 9.5pt; margin-bottom: 6mm; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-weight: 600; font-size: 9pt; color: #5b676b; border-bottom: 1.2pt solid #263033; padding: 2mm 1mm; }
td { padding: 1.8mm 1mm; border-bottom: .5pt solid #d5dad7; vertical-align: top; }
.r { text-align: right; }
.tot td { border: none; padding: 1.2mm 1mm; }
.tot .big td { font-weight: 700; font-size: 12pt; border-top: 1.2pt solid #263033; padding-top: 2mm; }
.foot { margin-top: 8mm; font-size: 9.5pt; }
.qr { margin-top: auto; width: 210mm; height: 105mm; break-inside: avoid; page-break-inside: avoid; }
.qr svg { width: 210mm; height: 105mm; display: block; }
.qr-error { color: #a33; padding: 0 18mm; }
.toolbar { text-align: center; padding: 10px; }
.toolbar button { font: inherit; padding: 8px 18px; border-radius: 6px; border: 0; background: #1F5B6E; color: #fff; cursor: pointer; }
@media print { body { background: #fff; } .page { margin: 0; } .toolbar { display: none; } }
</style></head><body>
<div class="toolbar"><button onclick="print()">Stampa o salva PDF</button></div>
<div class="page"><div class="content">
  <div class="head">
    <div><div class="brand">${esc(p.name)}</div>
      <div class="small">${esc(p.address)}<br>${esc(p.zip)} ${esc(p.city)}${p.phone ? '<br>Tel. ' + esc(p.phone) : ''}${p.email ? '<br>' + esc(p.email) : ''}</div></div>
    <div class="small" style="text-align:right">${p.vat_number && d.vat_registered ? 'N. IVA ' + esc(p.vat_number) + '<br>' : ''}${p.iban ? 'IBAN ' + esc(p.iban) : ''}</div>
  </div>
  <div class="addr">${[esc(`${b.first_name || ''} ${b.last_name || ''}`.trim()), esc(b.address), [esc(b.zip), esc(b.city)].filter(Boolean).join(' '), b.country && b.country !== 'CH' ? esc(b.country) : ''].filter(Boolean).join('<br>')}</div>
  <h1>Fattura ${esc(inv.number)}</h1>
  <div class="meta">
    <span>Data</span><span>${dmy(inv.date)}</span>
    <span>Soggiorno</span><span>${dmy(b.arrival)} – ${dmy(b.departure)}, camera ${esc(b.room_name)}, ${b.adults} ${b.adults === 1 ? 'adulto' : 'adulti'}${b.children ? ', ' + b.children + ' bambini' : ''}</span>
    <span>Prenotazione</span><span>${esc(b.code)}</span>
  </div>
  <table>
    <thead><tr><th>Descrizione</th><th class="r">Quantità</th><th class="r">Prezzo CHF</th>${d.vat_registered ? '<th class="r">IVA</th>' : ''}<th class="r">Importo CHF</th></tr></thead>
    <tbody>${d.lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="r">${l.qty}</td><td class="r">${chf(l.unit_price)}</td>${d.vat_registered ? `<td class="r">${l.vat_rate ? l.vat_rate + '%' : '–'}</td>` : ''}<td class="r">${chf(l.total)}</td></tr>`).join('')}</tbody>
  </table>
  <table class="tot" style="width:85mm;margin:4mm 0 0 auto">
    ${d.vat.map((v) => `<tr><td>di cui IVA ${v.rate}% su ${chf(v.gross)}</td><td class="r">${chf(v.vat)}</td></tr>`).join('')}
    <tr class="big"><td>Totale CHF</td><td class="r">${chf(d.total)}</td></tr>
    ${d.paid ? `<tr><td>Già pagato</td><td class="r">– ${chf(d.paid)}</td></tr><tr class="big"><td>Saldo da pagare</td><td class="r">${chf(balance)}</td></tr>` : ''}
  </table>
  <div class="foot">${balance > 0.04 ? `Da pagare entro il ${dmy(due)}.` : 'Fattura saldata. Grazie.'}<br>${d.vat_registered ? 'Prezzi IVA inclusa. La tassa di soggiorno non è soggetta a IVA.' : 'Non soggetto a IVA.'}<br>${esc(d.footer || '')}</div>
  </div>
  ${qr ? `<div class="qr">${qr}</div>` : ''}
</div></body></html>`;
}

module.exports = { renderInvoice };
