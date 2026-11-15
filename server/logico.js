// Importazione delle schede contabili (mastrini) esportate da Logico – Genio SA
// Formati: .xlsx, .xls, .csv (separatore , ; o tab). Le colonne vengono riconosciute dall'intestazione.
const XLSX = require('xlsx');
const { db, inferAccountType } = require('./db');
const { round2 } = require('./lib');

const COLS = {
  date: [/^data( reg| registrazione| valuta)?\b/i],
  doc_no: [/^n\.?\s*doc/i, /^num(ero)?\.?\s*doc/i, /^documento$/i, /^n\.?\s*reg/i],
  doc_type: [/^tipo/i],
  description: [/descri/i, /causale/i, /testo/i],
  contra: [/contropart/i, /^c\/p/i, /conto contr/i],
  dare: [/^dare/i, /^debito/i, /^soll/i],
  avere: [/^avere/i, /^credito/i, /^haben/i],
  saldo: [/saldo/i],
};

function parseAmount(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  let s = String(v).trim().replace(/CHF|EUR|Fr\.?/gi, '').replace(/[\s'’]/g, '');
  if (!s || s === '-') return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = parseFloat(s);
  if (Number.isNaN(n)) return undefined;
  return neg ? -n : n;
}

function parseDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v);
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return undefined;
}

function splitAccount(v) {
  const s = String(v || '').trim();
  const m = s.match(/^(\d{3,6})\s*[-–:]?\s*(.*)$/);
  return m ? { code: m[1], name: m[2].trim() } : null;
}

function readSheetRows(buffer, filename) {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    let text = buffer.toString('utf8');
    // export di Windows: codifica 1252 (lettere accentate, trattino lungo, apostrofo tipografico)
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buffer);
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/).slice(0, 15).join('\n');
    const counts = { ';': (first.match(/;/g) || []).length, ',': (first.match(/,/g) || []).length, '\t': (first.match(/\t/g) || []).length };
    const FS = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    const wb = XLSX.read(text, { type: 'string', FS, raw: true });
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
  }
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  // usa il primo foglio che contiene un'intestazione riconoscibile
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
    if (findHeader(rows) >= 0) return rows;
  }
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
}

function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const cells = (rows[i] || []).map((c) => String(c ?? '').trim());
    const hasDate = cells.some((c) => COLS.date.some((r) => r.test(c)));
    const hasAmt = cells.some((c) => COLS.dare.some((r) => r.test(c)) || COLS.avere.some((r) => r.test(c)));
    if (hasDate && hasAmt) return i;
  }
  return -1;
}

function parseLogico(buffer, filename, opts = {}) {
  const rows = readSheetRows(buffer, filename);
  const warnings = [];
  const meta = { source: '', period: '', account: null, currency: 'CHF' };
  const h = findHeader(rows);
  if (h < 0) throw new Error("Non trovo l'intestazione delle colonne (Data, Dare, Avere). Il file è un mastrino esportato da Logico?");

  for (let i = 0; i < h; i++) {
    const r = (rows[i] || []).filter((c) => c !== null && String(c).trim() !== '');
    if (!r.length) continue;
    const label = String(r[0]).trim().toLowerCase();
    const val = r.slice(1).join(' ').trim();
    if (label.startsWith('periodo')) meta.period = val;
    else if (label.startsWith('conto')) meta.account = splitAccount(val);
    else if (label.startsWith('valuta')) meta.currency = val || 'CHF';
    else if (!meta.source) meta.source = String(r[0]).trim();
    // "Conto: 1020 - Banca" in una sola cella
    const one = String(r[0]).match(/^conto\s*:\s*(.+)$/i);
    if (one) meta.account = splitAccount(one[1]);
  }
  if (opts.account) meta.account = { code: opts.account, name: meta.account?.name || '' };
  if (!meta.account) throw new Error('Il file non indica il conto del mastrino: sceglilo nel campo "Conto del mastrino".');
  if (meta.currency && meta.currency.toUpperCase() !== 'CHF') warnings.push(`Valuta del file: ${meta.currency}. L'app registra gli importi senza conversione.`);

  const header = rows[h].map((c) => String(c ?? '').trim());
  const idx = {};
  for (const [key, patterns] of Object.entries(COLS)) {
    idx[key] = header.findIndex((c) => c && patterns.some((p) => p.test(c)));
  }
  if (idx.dare === idx.saldo) idx.dare = -1; // evita che "saldo dare" venga preso per "dare"
  if (idx.date < 0) throw new Error('Manca la colonna Data.');

  const existing = db.prepare('SELECT 1 FROM journal WHERE dedupe_key = ? LIMIT 1');
  const known = new Set();
  const acc = meta.account.code;
  const out = [];
  let prevSaldo = null;
  let normal = 0; // +1 saldo = dare-avere, -1 saldo = avere-dare, 0 non ancora noto

  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (r.every((c) => c === null || String(c).trim() === '')) continue;
    const line = i + 1;
    const get = (k) => (idx[k] >= 0 ? r[idx[k]] : null);
    const description = String(get('description') ?? '').trim();
    const rawDate = get('date');
    const date = parseDate(rawDate);
    const dare = parseAmount(get('dare'));
    const avere = parseAmount(get('avere'));
    const saldo = parseAmount(get('saldo'));
    const docNo = get('doc_no') != null ? String(get('doc_no')).trim() : '';
    const docType = get('doc_type') != null ? String(get('doc_type')).trim() : '';
    const contra = splitAccount(get('contra'));
    const row = { line, date, doc_no: docNo, doc_type: docType, description, contra, dare: dare || 0, avere: avere || 0, saldo, status: 'nuovo', message: '' };

    if (/^(totale|totali|saldo finale|riporto a nuovo)/i.test(description) || /^totale/i.test(String(rawDate ?? ''))) continue;
    if (date === undefined || dare === undefined || avere === undefined) { row.status = 'errore'; row.message = 'Data o importo non leggibile'; out.push(row); continue; }
    if (!date) { continue; }

    const isOpening = !dare && !avere && saldo !== null && /saldo iniziale|apertura|riporto/i.test(description);
    if (isOpening) {
      row.kind = 'apertura';
      row.contra = { code: '9100', name: 'Bilancio di apertura' };
      const type = db.prepare('SELECT type FROM accounts WHERE code = ?').get(acc)?.type || inferAccountType(acc, meta.account.name);
      const debitNormal = type !== 'passivo' && type !== 'ricavo';
      const positiveIsDebit = debitNormal ? saldo >= 0 : saldo < 0;
      row.amount = Math.abs(saldo);
      row.debit_account = positiveIsDebit ? acc : '9100';
      row.credit_account = positiveIsDebit ? '9100' : acc;
      prevSaldo = saldo;
    } else {
      if (!dare && !avere) continue;
      if (!contra) { row.status = 'errore'; row.message = 'Contropartita mancante'; out.push(row); continue; }
      row.kind = 'movimento';
      const net = (dare || 0) - (avere || 0);
      row.amount = Math.abs(net);
      row.debit_account = net >= 0 ? acc : contra.code;
      row.credit_account = net >= 0 ? contra.code : acc;
      // controllo del saldo progressivo
      if (saldo !== null && prevSaldo !== null) {
        const asDebit = round2(prevSaldo + net), asCredit = round2(prevSaldo - net);
        if (!normal) normal = Math.abs(asDebit - saldo) < 0.01 ? 1 : Math.abs(asCredit - saldo) < 0.01 ? -1 : 0;
        const expected = normal === -1 ? asCredit : asDebit;
        if (Math.abs(expected - saldo) >= 0.01) {
          row.message = `Saldo progressivo atteso ${expected.toFixed(2)}, nel file ${saldo.toFixed(2)}`;
          warnings.push(`Riga ${line}: ${row.message}`);
        }
      }
      if (saldo !== null) prevSaldo = saldo;
    }
    row.amount = round2(row.amount);
    const pair = [row.debit_account, row.credit_account].sort().join('/');
    row.dedupe_key = `${row.date}|${row.amount.toFixed(2)}|${pair}|${row.kind === 'apertura' ? 'APERTURA' : docNo}`;
    if (existing.get(row.dedupe_key)) { row.status = 'duplicato'; row.message = row.message || 'Già presente in contabilità'; }
    else if (known.has(row.dedupe_key)) { row.status = 'duplicato'; row.message = 'Ripetuta nel file'; }
    known.add(row.dedupe_key);
    out.push(row);
  }

  const accountsToCreate = [];
  const accountsToRename = [];
  const exists = db.prepare('SELECT code, name FROM accounts WHERE code = ?');
  const seen = new Set();
  for (const a of [meta.account, ...out.map((r) => r.contra).filter(Boolean)]) {
    if (!a || seen.has(a.code)) continue;
    seen.add(a.code);
    const e = exists.get(a.code);
    if (!e) accountsToCreate.push({ code: a.code, name: a.name || `Conto ${a.code}`, type: inferAccountType(a.code, a.name) });
    else if (a.name && a.code !== '9100' && e.name.toLowerCase() !== a.name.toLowerCase()) accountsToRename.push({ code: a.code, from: e.name, to: a.name });
  }
  const summary = {
    rows: out.length,
    nuovi: out.filter((r) => r.status === 'nuovo').length,
    duplicati: out.filter((r) => r.status === 'duplicato').length,
    errori: out.filter((r) => r.status === 'errore').length,
    dare: round2(out.filter((r) => r.kind === 'movimento').reduce((a, r) => a + r.dare, 0)),
    avere: round2(out.filter((r) => r.kind === 'movimento').reduce((a, r) => a + r.avere, 0)),
    saldo_finale: prevSaldo,
  };
  return { meta, rows: out, warnings, accountsToCreate, accountsToRename, summary };
}

function commitLogico(parsed, filename, userId) {
  return db.transaction(() => {
    const insAcc = db.prepare('INSERT OR IGNORE INTO accounts (code, name, type) VALUES (?, ?, ?)');
    for (const a of parsed.accountsToCreate) insAcc.run(a.code, a.name, a.type);
    if (parsed.renameAccounts !== false) {
      const ren = db.prepare('UPDATE accounts SET name = ? WHERE code = ?');
      for (const a of parsed.accountsToRename || []) ren.run(a.to, a.code);
    }
    const toImport = parsed.rows.filter((r) => r.status === 'nuovo');
    const batch = db.prepare('INSERT INTO import_batches (filename, account, period, rows, skipped, user_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(filename, `${parsed.meta.account.code} ${parsed.meta.account.name || ''}`.trim(), parsed.meta.period, toImport.length, parsed.rows.length - toImport.length, userId).lastInsertRowid;
    const ins = db.prepare(`INSERT INTO journal (date, doc_no, doc_type, description, debit_account, credit_account, amount, source, dedupe_key, batch_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'logico', ?, ?)`);
    for (const r of toImport) {
      ins.run(r.date, r.doc_no || null, r.kind === 'apertura' ? 'APER' : r.doc_type || null, r.description || (r.kind === 'apertura' ? 'Saldo iniziale' : ''),
        r.debit_account, r.credit_account, r.amount, r.dedupe_key, batch);
    }
    return { batch_id: batch, imported: toImport.length, skipped: parsed.rows.length - toImport.length, accounts_created: parsed.accountsToCreate.length };
  })();
}

module.exports = { parseLogico, commitLogico, parseAmount, parseDate };
