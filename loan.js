/* ─────────────────────────────────────────────
   Home Loan Optimiser — loan.js  v2.1
   ───────────────────────────────────────────── */

'use strict';

// ── State ────────────────────────────────────────────────────────────────────
let extraPayments = [];   // array of integer IDs
let offsets       = [];   // array of integer IDs
let epCounter     = 0;
let offCounter    = 0;
let chartInstance = null;
let lastSimData   = null;
let calcTimer     = null;

// ── Formatting helpers ────────────────────────────────────────────────────────
function fmt(n)     { return '$' + Math.abs(Math.round(n)).toLocaleString('en-AU'); }
function fmtFull(n) { return '$' + Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtYM(months) {
  if (months <= 0) return '< 1mo';
  const y = Math.floor(months / 12), m = months % 12;
  if (y === 0) return m + 'mo';
  if (m === 0) return y + 'y';
  return y + 'y ' + m + 'mo';
}

// Read a numeric input by id (returns 0 if missing / blank)
function vEl(id) {
  const el = document.getElementById(id);
  return el ? (parseFloat(el.value) || 0) : 0;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

// ── Schedule recalculation (debounce) ─────────────────────────────────────────
function scheduleCalc() {
  clearTimeout(calcTimer);
  calcTimer = setTimeout(calculate, 350);
}

// ── Attach live-update listeners to inputs inside a container ─────────────────
function attachListeners(container) {
  container.querySelectorAll('input, select').forEach(el => {
    el.addEventListener('input',  scheduleCalc);
    el.addEventListener('change', scheduleCalc);
  });
}

// ── Dynamic Extra Payments ────────────────────────────────────────────────────
function addExtraPayment(data = {}) {
  const id     = ++epCounter;
  const label  = data.label     || '';
  const amount = data.amount    !== undefined ? data.amount : '';
  const freq   = data.frequency || 'monthly';

  extraPayments.push(id);

  const div = document.createElement('div');
  div.className = 'dynamic-item';
  div.id = 'ep-' + id;
  div.innerHTML = `
    <div class="dynamic-item-header">
      <span class="dynamic-item-title">Extra payment ${id}</span>
      <button class="remove-btn" onclick="removeItem('ep-${id}','ep',${id})" title="Remove">✕</button>
    </div>
    <div class="field-row-3">
      <div class="field" style="grid-column:span 1">
        <label>Label</label>
        <input type="text" id="ep-label-${id}" value="${label}" placeholder="e.g. Incentive">
      </div>
      <div class="field">
        <label>Amount ($)</label>
        <div class="input-wrap has-prefix">
          <span class="input-prefix">$</span>
          <input type="number" id="ep-amount-${id}" value="${amount}" step="1" placeholder="0">
        </div>
      </div>
      <div class="field">
        <label>Frequency</label>
        <select id="ep-freq-${id}">
          <option value="monthly"${freq === 'monthly'        ? ' selected' : ''}>Monthly</option>
          <option value="fortnightly"${freq === 'fortnightly'? ' selected' : ''}>Fortnightly</option>
          <option value="weekly"${freq === 'weekly'          ? ' selected' : ''}>Weekly</option>
          <option value="yearly"${freq === 'yearly'          ? ' selected' : ''}>Yearly</option>
          <option value="once"${freq === 'once'              ? ' selected' : ''}>One-off</option>
        </select>
      </div>
    </div>`;

  document.getElementById('extra-payments-list').appendChild(div);
  attachListeners(div);
  scheduleCalc();
}

// Return extra payment totals split into:
//   recurringMonthly — ongoing $/month applied every month
//   onceOff          — lump sum applied in month 1 only
function getExtraPayments() {
  const freqMap = { monthly: 1, fortnightly: 26 / 12, weekly: 52 / 12, yearly: 1 / 12 };
  let recurringMonthly = 0;
  let onceOff = 0;
  extraPayments.forEach(id => {
    const el = document.getElementById('ep-' + id);
    if (!el) return;
    const amt  = parseFloat(document.getElementById('ep-amount-' + id)?.value) || 0;
    const freq = document.getElementById('ep-freq-' + id)?.value || 'monthly';
    if (freq === 'once') {
      onceOff += amt;
    } else {
      recurringMonthly += amt * (freqMap[freq] || 1);
    }
  });
  return { recurringMonthly, onceOff };
}

// ── Dynamic Offset Accounts ───────────────────────────────────────────────────
function addOffset(data = {}) {
  const id      = ++offCounter;
  const label   = data.label       || '';
  const bal     = data.balance     !== undefined ? data.balance  : '';
  const dep     = data.deposit     !== undefined ? data.deposit  : '';
  const freq    = data.depositFreq || 'fortnightly';
  // repaymentSource: true means this account is debited for min repayments
  // Default: first offset added is the repayment source
  const isSource = data.repaymentSource !== undefined
    ? data.repaymentSource
    : (offsets.length === 0);   // first one defaults to true

  offsets.push(id);

  const div = document.createElement('div');
  div.className = 'dynamic-item';
  div.id = 'off-' + id;
  div.innerHTML = `
    <div class="dynamic-item-header">
      <span class="dynamic-item-title">Offset account ${id}</span>
      <button class="remove-btn" onclick="removeItem('off-${id}','off',${id})" title="Remove">✕</button>
    </div>
    <div class="field-row">
      <div class="field" style="grid-column:span 2">
        <label>Account label</label>
        <input type="text" id="off-label-${id}" value="${label}" placeholder="e.g. Salary offset">
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Current balance ($)</label>
        <div class="input-wrap has-prefix">
          <span class="input-prefix">$</span>
          <input type="number" id="off-bal-${id}" value="${bal}" step="0.01" placeholder="0">
        </div>
      </div>
      <div class="field">
        <label>Deposit amount ($)</label>
        <div class="input-wrap has-prefix">
          <span class="input-prefix">$</span>
          <input type="number" id="off-dep-${id}" value="${dep}" step="1" placeholder="0">
        </div>
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Deposit frequency</label>
        <select id="off-depfreq-${id}">
          <option value="fortnightly"${freq === 'fortnightly' ? ' selected' : ''}>Fortnightly</option>
          <option value="monthly"${freq === 'monthly'         ? ' selected' : ''}>Monthly</option>
          <option value="weekly"${freq === 'weekly'           ? ' selected' : ''}>Weekly</option>
        </select>
      </div>
      <div class="field">
        <label>Repayment source</label>
        <div class="repay-source-toggle" id="off-source-wrap-${id}">
          <select id="off-source-${id}" onchange="handleSourceChange(${id})">
            <option value="yes"${isSource ? ' selected' : ''}>Yes — debited here</option>
            <option value="no"${!isSource ? ' selected' : ''}>No — separate debit</option>
          </select>
        </div>
      </div>
    </div>
    <div class="repay-source-note" id="off-source-note-${id}" style="display:${isSource ? 'block' : 'none'}">
      Min repayment is debited from this account each cycle. The simulation deducts it from the running balance before calculating interest.
    </div>`;

  document.getElementById('offset-list').appendChild(div);
  attachListeners(div);
  scheduleCalc();
}

// When one account is marked as repayment source, enforce only-one rule
function handleSourceChange(changedId) {
  const val = document.getElementById('off-source-' + changedId)?.value;
  if (val === 'yes') {
    // Set all others to 'no'
    offsets.forEach(id => {
      if (id !== changedId) {
        const el = document.getElementById('off-source-' + id);
        if (el) el.value = 'no';
        const note = document.getElementById('off-source-note-' + id);
        if (note) note.style.display = 'none';
      }
    });
  }
  const note = document.getElementById('off-source-note-' + changedId);
  if (note) note.style.display = (val === 'yes') ? 'block' : 'none';
  scheduleCalc();
}

// Collect all offset data for the simulation
// Returns array of { startBal, depMonthly, isRepaySource }
function getOffsetList() {
  const freqMap = { fortnightly: 26 / 12, monthly: 1, weekly: 52 / 12 };
  return offsets.map(id => {
    const el = document.getElementById('off-' + id);
    if (!el) return null;
    const bal    = parseFloat(document.getElementById('off-bal-' + id)?.value)    || 0;
    const dep    = parseFloat(document.getElementById('off-dep-' + id)?.value)    || 0;
    const freq   = document.getElementById('off-depfreq-' + id)?.value || 'fortnightly';
    const source = document.getElementById('off-source-' + id)?.value  || 'no';
    return {
      startBal:       bal,
      depMonthly:     dep * (freqMap[freq] || 1),
      isRepaySource:  source === 'yes'
    };
  }).filter(Boolean);
}

// Convenience totals (used for display metrics only)
function getOffsetTotals() {
  const list = getOffsetList();
  return {
    totalBal:        list.reduce((s, o) => s + o.startBal, 0),
    totalDepMonthly: list.reduce((s, o) => s + o.depMonthly, 0)
  };
}

// Remove a dynamic item
function removeItem(divId, type, id) {
  const el = document.getElementById(divId);
  if (el) el.remove();
  if (type === 'ep')  extraPayments = extraPayments.filter(x => x !== id);
  if (type === 'off') offsets       = offsets.filter(x => x !== id);
  scheduleCalc();
}

// ── Loan simulation ───────────────────────────────────────────────────────────
//
// Interest is calculated daily (rate/365) and charged monthly.
// effectiveBalance = loanBalance - SUM(all offset balances)
//
// Repayment source logic:
//   If an offset account is marked as "repayment source", the minimum
//   repayment is debited FROM that account's balance each month (in
//   addition to the regular payment reducing the loan principal).
//   This correctly models the salary-cycling strategy where the bank
//   pulls repayments straight from offset.
//
//   If no account is marked as repayment source (e.g. direct debit
//   from a non-offset account), the offset balances are NOT reduced
//   by repayments — they grow unimpeded.
//
// offsetList:        array of { startBal, depMonthly, isRepaySource }
// recurringMonthly:  extra $/month applied every month (recurring payments)
// onceOff:           lump sum applied to principal in month 1 only
// minRepayMonthly:   minimum repayment converted to monthly
//
function simulateLoan(startBal, offsetList, recurringMonthly, onceOff, minRepayMonthly, rateAnnual) {
  const RM = rateAnnual / 12;

  // Initialise per-account running balances
  let offBalances = offsetList.map(o => o.startBal);

  let bal = startBal;
  let months = 0, totalInt = 0, cumInt = 0;
  const yearlyData = [], monthlyData = [], balances = [bal];
  let yInt = 0, yPri = 0;

  while (bal > 0.01 && months < 720) {
    // 1. Total offset = sum of all running account balances
    const totalOff = offBalances.reduce((s, b) => s + Math.max(0, b), 0);

    // 2. Interest charged this month on effective balance
    const effBal   = Math.max(0, bal - totalOff);
    const interest = effBal * RM;

    // 3. Total payment applied to the loan this month
    //    One-off lump sum is added on top in month 1 only
    const thisMonthExtra = recurringMonthly + (months === 0 ? onceOff : 0);
    const payment = minRepayMonthly + thisMonthExtra;
    let principal = payment - interest;
    if (principal < 0) principal = 0;
    principal = Math.min(principal, bal);

    yInt += interest; yPri += principal;
    totalInt += interest; cumInt += interest;
    bal -= principal;
    if (bal < 0) bal = 0;

    // 4. Update each offset account balance
    //    - Add monthly deposit
    //    - Deduct repayment from the source account (if any)
    offBalances = offBalances.map((ob, i) => {
      let newBal = ob + offsetList[i].depMonthly;
      if (offsetList[i].isRepaySource) {
        // Repayment debited from this account
        newBal -= minRepayMonthly;
        // Account can go negative (overdraft buffer) but cap floor at 0
        // so it doesn't give a negative offset benefit to the loan
        if (newBal < 0) newBal = 0;
      }
      return newBal;
    });

    months++;
    const displayOff = offBalances.reduce((s, b) => s + b, 0);

    monthlyData.push({ month: months, balance: bal, interest, principal, offset: displayOff, payment, onceOff: months === 1 && onceOff > 0 ? onceOff : 0 });

    if (months % 12 === 0 || bal <= 0.01) {
      yearlyData.push({
        year:        Math.ceil(months / 12),
        balance:     Math.max(0, bal),
        interest:    yInt,
        principal:   yPri,
        cumInterest: cumInt,
        offset:      displayOff
      });
      yInt = 0; yPri = 0;
      balances.push(Math.max(0, bal));
    }
    if (bal <= 0.01) break;
  }
  return { months, totalInterest: totalInt, yearlyData, monthlyData, balances };
}

// ── Main calculate ────────────────────────────────────────────────────────────
function calculate() {
  const balance      = vEl('balance');
  const rate         = vEl('rate') / 100;
  const minRepay     = vEl('min-repay');
  const freq         = parseInt(document.getElementById('frequency').value) || 26;
  const minRepayMonthly               = minRepay * freq / 12;
  const { recurringMonthly, onceOff } = getExtraPayments();
  const offsetList                    = getOffsetList();
  const { totalBal: totalOffset }     = getOffsetTotals();

  // Minimum-only: no offset, no extras — baseline
  const minSim  = simulateLoan(balance, [],         0,                0,       minRepayMonthly, rate);
  const currSim = simulateLoan(balance, offsetList, recurringMonthly, onceOff, minRepayMonthly, rate);

  lastSimData = { minSim, currSim, balance, rate, totalOffset, recurringMonthly, onceOff, minRepayMonthly, offsetList };

  const timeSaved    = minSim.months - currSim.months;
  const intSaved     = minSim.totalInterest - currSim.totalInterest;
  const annualSaving = totalOffset * rate;
  const effectiveBal = balance - totalOffset;

  // Determine whether repayment source is active for the info badge
  const hasSource = offsetList.some(o => o.isRepaySource);

  document.getElementById('effective-rate-badge').textContent =
    'Rate: ' + (rate * 100).toFixed(2) + '% · Offset: ' + fmt(totalOffset) +
    (hasSource ? ' · Repay from offset' : ' · Direct repay');

  const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setTxt('m-payoff-min',        fmtYM(minSim.months));
  setTxt('m-interest-min',      fmt(minSim.totalInterest) + ' interest');
  setTxt('m-payoff-current',    fmtYM(currSim.months));
  setTxt('m-interest-current',  fmt(currSim.totalInterest) + ' interest');
  setTxt('m-time-saved',        fmtYM(Math.max(0, timeSaved)));
  setTxt('m-interest-saved',    fmt(intSaved) + ' saved');
  setTxt('m-effective-balance', fmt(effectiveBal));
  setTxt('m-offset-total',      fmt(totalOffset) + ' total offset');
  setTxt('m-annual-saving',     fmt(annualSaving) + '/yr');


  setTxt('banner-main', fmt(intSaved) + ' saved · ' + fmtYM(Math.max(0, timeSaved)) + ' sooner');
  setTxt('banner-desc', 'Current strategy vs minimum repayments — paid off ' + fmtYM(Math.max(0, timeSaved)) + ' earlier');

  // Repayment mode notice
  const noticeEl = document.getElementById('repay-mode-notice');
  if (noticeEl) {
    if (hasSource) {
      noticeEl.textContent = '⚠ Repayments debited from offset — offset balance reduced each cycle before interest is calculated.';
      noticeEl.className   = 'repay-notice repay-notice-warn';
    } else {
      noticeEl.textContent = 'ℹ Repayments drawn from a separate account — offset balances grow unaffected by repayments.';
      noticeEl.className   = 'repay-notice repay-notice-info';
    }
    noticeEl.style.display = 'block';
  }

  document.getElementById('scenario-bar').innerHTML =
    '<strong>' + fmtYM(currSim.months) + '</strong> payoff <span class="sep">·</span> ' +
    '<strong>' + fmt(currSim.totalInterest) + '</strong> total interest <span class="sep">·</span> ' +
    '<strong style="color:var(--accent)">' + fmtYM(Math.max(0, timeSaved)) + '</strong> saved vs min only';

  updateChart(minSim, currSim);
  updateYearlyTable(currSim);
  updateMonthlyTable(currSim);

  document.getElementById('last-updated').textContent =
    'Updated ' + new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
}

// ── Chart ─────────────────────────────────────────────────────────────────────
function updateChart(minSim, currSim) {
  const maxYears = Math.ceil(minSim.months / 12);
  const labels   = Array.from({ length: maxYears + 1 }, (_, i) => 'Y' + i);
  const pad      = (arr, len) => { const a = [...arr]; while (a.length < len) a.push(0); return a; };

  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(document.getElementById('loanChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Minimum only',     data: pad(minSim.balances,  maxYears + 1), borderColor: '#ff5c5c', borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: false, borderDash: [5, 4] },
        { label: 'Current strategy', data: pad(currSim.balances, maxYears + 1), borderColor: '#00d4a0', borderWidth: 2.5, pointRadius: 0, tension: 0.3, fill: { target: 'origin', above: 'rgba(0,212,160,0.04)' } }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1e25', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
          titleColor: '#8b919c', bodyColor: '#e8eaed',
          callbacks: { label: ctx => ctx.dataset.label + ': ' + fmt(ctx.parsed.y) }
        }
      },
      scales: {
        y: { ticks: { callback: v => '$' + (v / 1000).toFixed(0) + 'k', font: { size: 11, family: 'DM Mono' }, color: '#555d6b' }, grid: { color: 'rgba(255,255,255,0.04)' }, border: { color: 'rgba(255,255,255,0.07)' } },
        x: { ticks: { font: { size: 11, family: 'DM Mono' }, color: '#555d6b', maxTicksLimit: 12 },             grid: { color: 'rgba(255,255,255,0.04)' }, border: { color: 'rgba(255,255,255,0.07)' } }
      }
    }
  });
}

// ── Tables ────────────────────────────────────────────────────────────────────
function updateYearlyTable(sim) {
  const tb = document.getElementById('yearly-body');
  tb.innerHTML = '';
  sim.yearlyData.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.year}</td><td class="td-bal">${fmt(r.balance)}</td><td class="td-int">${fmt(r.interest)}</td><td class="td-pri">${fmt(r.principal)}</td><td class="td-cum">${fmt(r.cumInterest)}</td><td>${fmt(r.offset)}</td>`;
    tb.appendChild(tr);
  });
}

function updateMonthlyTable(sim) {
  const tb = document.getElementById('monthly-body');
  tb.innerHTML = '';
  sim.monthlyData.slice(0, 60).forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.month}</td><td class="td-bal">${fmt(r.balance)}</td><td class="td-int">${fmt(r.interest)}</td><td class="td-pri">${fmt(r.principal)}</td><td>${fmt(r.offset)}</td><td>${fmt(r.payment)}</td>`;
    tb.appendChild(tr);
  });
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function showTab(id, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  btn.classList.add('active');
}

// ── Reset (all to zero) ───────────────────────────────────────────────────────
function confirmReset() {
  if (confirm('Clear all fields and set values to zero?')) resetToZero();
}

function resetToZero() {
  ['balance','redraw','rate','min-repay'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  updateScheduledBalance();
  document.getElementById('frequency').value = '26';
  document.getElementById('loan-type').value = 'pi';
  document.getElementById('rate-type').value = 'variable';

  document.getElementById('extra-payments-list').innerHTML = '';
  document.getElementById('offset-list').innerHTML         = '';
  extraPayments = []; offsets = []; epCounter = 0; offCounter = 0;

  const n = document.getElementById('repay-mode-notice');
  if (n) n.style.display = 'none';

  toast('All fields cleared ✓');
  calculate();
}

// ── CSV Data Export ───────────────────────────────────────────────────────────
function exportData() {
  const epData = extraPayments.map(id => ({
    label:     document.getElementById('ep-label-'  + id)?.value || '',
    amount:    parseFloat(document.getElementById('ep-amount-' + id)?.value) || 0,
    frequency: document.getElementById('ep-freq-'   + id)?.value || 'monthly'
  }));

  const offData = offsets.map(id => ({
    label:           document.getElementById('off-label-'    + id)?.value || '',
    balance:         parseFloat(document.getElementById('off-bal-' + id)?.value)  || 0,
    deposit:         parseFloat(document.getElementById('off-dep-' + id)?.value)  || 0,
    depositFreq:     document.getElementById('off-depfreq-'  + id)?.value || 'fortnightly',
    repaymentSource: document.getElementById('off-source-'   + id)?.value === 'yes'
  }));

  const esc = v => {
    const s = String(v);
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
      ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const headers = [
    'balance','redraw','rate_percent',
    'min_repayment','repay_frequency','loan_type','rate_type',
    'extra_payments_json','offsets_json'
  ];

  const values = [
    vEl('balance'), vEl('redraw'), vEl('rate'),
    vEl('min-repay'), document.getElementById('frequency').value,
    document.getElementById('loan-type').value, document.getElementById('rate-type').value,
    JSON.stringify(epData), JSON.stringify(offData)
  ];

  const csv = headers.map(esc).join(',') + '\n' + values.map(esc).join(',');
  downloadFile('loan-settings-' + new Date().toISOString().slice(0, 10) + '.csv', 'text/csv', csv);
  toast('Settings exported ✓');
}

// ── CSV Data Import ───────────────────────────────────────────────────────────
function triggerImport() {
  document.getElementById('import-file-input').click();
}

function handleImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      loadFromCSV(e.target.result);
      toast('Settings imported ✓');
    } catch (err) {
      alert('Import failed: ' + err.message + '\n\nMake sure you are importing a file exported from this app.');
    }
    event.target.value = '';
  };
  reader.readAsText(file);
}

function loadFromCSV(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) throw new Error('File must have at least two lines (header + values).');

  const parseCSVRow = row => {
    const result = [];
    let cur = '', inQuote = false;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '"') {
        if (inQuote && row[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        result.push(cur); cur = '';
      } else { cur += ch; }
    }
    result.push(cur);
    return result;
  };

  const headers = parseCSVRow(lines[0]);
  const values  = parseCSVRow(lines[1]);
  const data    = {};
  headers.forEach((h, i) => { data[h.trim()] = (values[i] || '').trim(); });

  const setVal = (id, key) => {
    const el = document.getElementById(id);
    if (el && data[key] !== undefined) el.value = data[key];
  };
  setVal('balance',   'balance');
  setVal('redraw',    'redraw');
  setVal('rate',      'rate_percent');
  setVal('min-repay', 'min_repayment');
  setVal('frequency', 'repay_frequency');
  setVal('loan-type', 'loan_type');
  setVal('rate-type', 'rate_type');
  updateScheduledBalance();

  document.getElementById('extra-payments-list').innerHTML = '';
  document.getElementById('offset-list').innerHTML         = '';
  extraPayments = []; offsets = []; epCounter = 0; offCounter = 0;

  if (data['extra_payments_json']) {
    JSON.parse(data['extra_payments_json']).forEach(ep => addExtraPayment(ep));
  }
  if (data['offsets_json']) {
    JSON.parse(data['offsets_json']).forEach(o => addOffset(o));
  }

  calculate();
}

// ── HTML Report download ──────────────────────────────────────────────────────
function downloadReport() {
  if (!lastSimData) { toast('Calculate first'); return; }
  const { minSim, currSim, whatifSim, balance, rate, totalOffset, extraMonthly, offsetList } = lastSimData;
  const intSaved  = minSim.totalInterest - currSim.totalInterest;
  const timeSaved = minSim.months - currSim.months;
  const now       = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  const hasSource = offsetList.some(o => o.isRepaySource);

  const yearRows = currSim.yearlyData.map(r => `
    <tr>
      <td>${r.year}</td>
      <td>$${Math.round(r.balance).toLocaleString('en-AU')}</td>
      <td style="color:#cc3333">$${Math.round(r.interest).toLocaleString('en-AU')}</td>
      <td style="color:#007755">$${Math.round(r.principal).toLocaleString('en-AU')}</td>
      <td style="color:#996600">$${Math.round(r.cumInterest).toLocaleString('en-AU')}</td>
      <td>$${Math.round(r.offset).toLocaleString('en-AU')}</td>
    </tr>`).join('');

  const offsetDetails = offsets.map(id => {
    const label  = document.getElementById('off-label-'   + id)?.value || 'Offset ' + id;
    const bal    = parseFloat(document.getElementById('off-bal-'    + id)?.value) || 0;
    const dep    = parseFloat(document.getElementById('off-dep-'    + id)?.value) || 0;
    const freq   = document.getElementById('off-depfreq-' + id)?.value || 'fortnightly';
    const source = document.getElementById('off-source-'  + id)?.value === 'yes' ? ' ★ repayment source' : '';
    return `${label}${source}: $${bal.toLocaleString('en-AU', { minimumFractionDigits: 2 })} balance · $${dep.toLocaleString('en-AU')} ${freq}`;
  }).join('<br>') || 'No offset accounts';

  const epDetails = extraPayments.map(id => {
    const label = document.getElementById('ep-label-'  + id)?.value || 'Extra ' + id;
    const amt   = parseFloat(document.getElementById('ep-amount-' + id)?.value) || 0;
    const freq  = document.getElementById('ep-freq-'   + id)?.value || 'monthly';
    return `${label}: $${amt.toLocaleString('en-AU')} ${freq}`;
  }).join('<br>') || 'No extra payments';

  const freqLabel = document.getElementById('frequency').options[document.getElementById('frequency').selectedIndex]?.text || '';
  const repayModeNote = hasSource
    ? 'Repayments debited from offset account — offset balance reduced each cycle before interest is calculated.'
    : 'Repayments drawn from a separate account — offset balances grow unaffected by repayments.';

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Home Loan Report — ${now}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  body{font-family:'DM Sans',sans-serif;background:#f5f5f2;color:#1a1a18;margin:0;padding:2rem;}
  .page{max-width:900px;margin:0 auto;}
  .header{border-bottom:2px solid #1a1a18;padding-bottom:1rem;margin-bottom:2rem;}
  .header h1{font-size:24px;font-weight:600;letter-spacing:-0.02em;}
  .header p{color:#666;font-size:13px;font-family:'DM Mono',monospace;margin-top:4px;}
  .metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#ddd;border:1px solid #ddd;border-radius:10px;overflow:hidden;margin-bottom:1.5rem;}
  .metric{background:#fff;padding:1rem 1.1rem;}
  .metric-label{font-size:10px;color:#888;font-family:'DM Mono',monospace;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:5px;}
  .metric-val{font-size:20px;font-weight:600;font-family:'DM Mono',monospace;letter-spacing:-0.02em;}
  .metric-val.green{color:#007755;}.metric-val.red{color:#cc3333;}.metric-val.amber{color:#996600;}
  .metric-sub{font-size:10px;color:#999;margin-top:3px;font-family:'DM Mono',monospace;}
  .banner{background:#e8f9f4;border:1px solid #a0dfc8;border-radius:8px;padding:1rem 1.25rem;margin-bottom:1.5rem;display:flex;gap:1rem;align-items:center;}
  .banner-icon{font-size:26px;}.banner-main{font-size:15px;font-weight:600;color:#007755;font-family:'DM Mono',monospace;}
  .banner-desc{font-size:12px;color:#555;margin-top:2px;}
  .repay-note{background:#fff8e6;border:1px solid #f0d080;border-left:3px solid #e0a020;border-radius:8px;padding:0.75rem 1rem;margin-bottom:1.5rem;font-size:12px;color:#665500;font-family:'DM Mono',monospace;}
  .inputs-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:2rem;}
  .input-card{background:#fff;border:1px solid #e0e0dc;border-radius:10px;padding:1rem 1.25rem;}
  .input-card h3{font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:#888;font-family:'DM Mono',monospace;margin-bottom:0.75rem;}
  .input-card p{font-size:13px;color:#333;line-height:1.7;font-family:'DM Mono',monospace;}
  table{width:100%;border-collapse:collapse;font-size:13px;font-family:'DM Mono',monospace;}
  thead th{text-align:left;color:#888;font-size:10px;letter-spacing:0.06em;text-transform:uppercase;padding:8px 10px;border-bottom:1px solid #ddd;font-weight:400;}
  thead th:not(:first-child){text-align:right;}
  tbody td{padding:8px 10px;border-bottom:1px solid #eee;color:#333;}
  tbody td:not(:first-child){text-align:right;}
  tbody tr:nth-child(even){background:#fafafa;}
  .section-title{font-size:13px;font-weight:600;color:#1a1a18;margin:2rem 0 0.75rem;}
  .footer{margin-top:3rem;padding-top:1rem;border-top:1px solid #ddd;font-size:11px;color:#aaa;font-family:'DM Mono',monospace;}
</style></head>
<body><div class="page">
  <div class="header">
    <h1>Home Loan Analysis Report</h1>
    <p>Generated ${now} · Home Loan Optimiser v2.1</p>
  </div>
  <div class="metrics">
    <div class="metric"><div class="metric-label">Payoff — min only</div><div class="metric-val red">${fmtYM(minSim.months)}</div><div class="metric-sub">$${Math.round(minSim.totalInterest).toLocaleString('en-AU')} total interest</div></div>
    <div class="metric"><div class="metric-label">Payoff — current</div><div class="metric-val green">${fmtYM(currSim.months)}</div><div class="metric-sub">$${Math.round(currSim.totalInterest).toLocaleString('en-AU')} total interest</div></div>
    <div class="metric"><div class="metric-label">Time saved</div><div class="metric-val amber">${fmtYM(Math.max(0, timeSaved))}</div><div class="metric-sub">$${Math.round(intSaved).toLocaleString('en-AU')} interest saved</div></div>
    <div class="metric"><div class="metric-label">Loan balance</div><div class="metric-val">$${Math.round(balance).toLocaleString('en-AU')}</div><div class="metric-sub">Current balance</div></div>
    <div class="metric"><div class="metric-label">Total offset</div><div class="metric-val green">$${Math.round(totalOffset).toLocaleString('en-AU')}</div><div class="metric-sub">$${Math.round(totalOffset * rate).toLocaleString('en-AU')}/yr saved</div></div>
    <div class="metric"><div class="metric-label">Interest rate</div><div class="metric-val">${(rate * 100).toFixed(2)}%</div><div class="metric-sub">p.a.</div></div>
  </div>
  <div class="banner">
    <div class="banner-icon">💰</div>
    <div>
      <div class="banner-main">$${Math.round(intSaved).toLocaleString('en-AU')} saved · ${fmtYM(Math.max(0, timeSaved))} sooner</div>
      <div class="banner-desc">Current strategy vs minimum repayments only</div>
    </div>
  </div>
  <div class="repay-note">Repayment mode: ${repayModeNote}</div>
  <div class="inputs-grid">
    <div class="input-card"><h3>Repayment details</h3><p>
      Minimum repayment: $${vEl('min-repay').toLocaleString('en-AU')} (${freqLabel})<br>
      Extra payments: $${Math.round(extraMonthly).toLocaleString('en-AU')}/month combined<br>
      ${epDetails}
    </p></div>
    <div class="input-card"><h3>Offset accounts</h3><p>${offsetDetails}</p></div>
  </div>
  <p class="section-title">Year-by-year projection (current strategy)</p>
  <table><thead><tr><th>Year</th><th>Balance</th><th>Interest paid</th><th>Principal paid</th><th>Cumul. interest</th><th>Offset balance</th></tr></thead>
  <tbody>${yearRows}</tbody></table>
  <div class="footer">Generated by Home Loan Optimiser v2.1 · For personal modelling purposes only · Consult a financial adviser for personalised advice</div>
</div></body></html>`;

  downloadFile('home-loan-report-' + new Date().toISOString().slice(0, 10) + '.html', 'text/html', html);
  toast('Report downloaded ✓');
}

// ── CSV Table export (yearly data) ────────────────────────────────────────────
function downloadCSV() {
  if (!lastSimData) { toast('Calculate first'); return; }
  const { currSim } = lastSimData;
  const rows = [['Year', 'Balance', 'Interest Paid', 'Principal Paid', 'Cumulative Interest', 'Offset Balance']];
  currSim.yearlyData.forEach(r => {
    rows.push([r.year, Math.round(r.balance), Math.round(r.interest), Math.round(r.principal), Math.round(r.cumInterest), Math.round(r.offset)]);
  });
  downloadFile('loan-yearly-' + new Date().toISOString().slice(0, 10) + '.csv', 'text/csv', rows.map(r => r.join(',')).join('\n'));
  toast('CSV downloaded ✓');
}

// ── Generic file download helper ──────────────────────────────────────────────
function downloadFile(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Init ──────────────────────────────────────────────────────────────────────
function updateScheduledBalance() {
  const balance = vEl('balance');
  const redraw  = vEl('redraw');
  const el      = document.getElementById('scheduled-balance');
  if (el) el.value = (balance + redraw).toFixed(2);
}

function init() {
  ['balance', 'redraw', 'rate', 'min-repay'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input',  () => { updateScheduledBalance(); scheduleCalc(); });
      el.addEventListener('change', () => { updateScheduledBalance(); scheduleCalc(); });
    }
  });
  ['frequency', 'loan-type', 'rate-type'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', scheduleCalc);
  });
  document.getElementById('import-file-input').addEventListener('change', handleImport);
  updateScheduledBalance();
  calculate();
}

document.addEventListener('DOMContentLoaded', init);