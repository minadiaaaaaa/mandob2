// Reads every table the page shows (HTML tables and ARIA grids), keeps the largest, and sends its rows.
// It never reads passwords or cookies: only the table text in front of you.
const $ = (id) => document.getElementById(id);
const state = (t) => { $('state').textContent = t; };
let rows = null;

chrome.storage.local.get(['url', 'token', 'source'], (s) => {
  if (s.url) $('url').value = s.url;
  if (s.token) $('token').value = s.token;
  if (s.source) $('source').value = s.source;
  const y = new Date(Date.now() - 86400000);
  $('day').value = y.toISOString().slice(0, 10);
});
$('save').onclick = () => chrome.storage.local.set({ url: $('url').value.trim(), token: $('token').value.trim() }, () => state('Connection saved.'));
$('source').onchange = () => chrome.storage.local.set({ source: $('source').value });

function readTables() {
  const text = (el) => (el.innerText || el.textContent || '').trim();
  const grids = [];
  for (const t of document.querySelectorAll('table')) {
    const trs = [...t.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('th,td')].map(text));
    if (trs.length > 1) grids.push(trs);
  }
  for (const g of document.querySelectorAll('[role=grid],[role=table]')) {
    const trs = [...g.querySelectorAll('[role=row]')].map((r) => [...r.querySelectorAll('[role=columnheader],[role=gridcell],[role=cell]')].map(text));
    if (trs.length > 1) grids.push(trs);
  }
  grids.sort((a, b) => b.length - a.length);
  const g = grids[0];
  if (!g) return null;
  const head = g[0];
  return g.slice(1).filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(head.map((h, i) => [h || `col${i + 1}`, r[i] ?? ''])));
}

$('capture').onclick = async () => {
  rows = null; $('send').disabled = true; state('Loading…');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readTables });
    rows = res.result;
    if (!rows || !rows.length) { state('Incomplete: no table with rows on this page. Wait for the full table, then Capture again.'); return; }
    $('send').disabled = false;
    state(`Ready to send: ${rows.length} rows.`);
  } catch (e) { state(`Could not read this page: ${e.message}`); }
};

$('send').onclick = async () => {
  const url = $('url').value.trim(); const token = $('token').value.trim();
  if (!url || !token) { state('Fill in the connection settings first.'); return; }
  $('send').disabled = true; state('Sending…');
  const messages = { token_refused: 'Token refused: issue a new token and paste it here.', not_a_sync_source: 'This page is not a sync source.',
    set_one_day: 'Set the date to one day.', report_shows_today: 'The report shows today: choose yesterday or earlier.', sync_running: 'The system is busy: wait a minute, then send again.' };
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ source: $('source').value, day: $('day').value, rows }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { state(messages[j.error] || `Refused: ${j.error || r.status}`); $('send').disabled = false; return; }
    state(`Done. Read ${j.read ?? rows.length}, added ${j.inserted ?? 0}, replaced ${j.replaced ?? 0}.`);
  } catch { state('Could not reach the system: check the ingest address.'); $('send').disabled = false; }
};
