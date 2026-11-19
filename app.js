'use strict';

/* ================= constants ================= */

const DENOMS = [500, 200, 100, 50, 20, 10, 5];
const STORAGE_KEY = 'mc-data-v1';   // encrypted session data (JSON payload)
const KEK_KEY = 'mc-kek-fallback';  // fallback raw key if the browser can't store a CryptoKey
const HOLD_MS = 450;                // long-press duration to remove a note
const EDGE_PX = 28;                 // swipe-from-left-edge zone
const TAP_SLOP = 12;                // movement tolerance before a press becomes a drag

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString('en-IE');
const vibrate = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };
const hasSubtle = typeof crypto !== 'undefined' && !!crypto.subtle;

/* ================= state ================= */

let state = null;      // { v:1, current:{startedAt, counts}, history:[{startedAt, endedAt, counts}] }
let cryptoKey = null;  // AES-GCM CryptoKey

const emptyCounts = () => Object.fromEntries(DENOMS.map((d) => [d, 0]));
const freshState = () => ({ v: 1, current: { startedAt: Date.now(), counts: emptyCounts() }, history: [] });
const totalOf = (counts) => DENOMS.reduce((s, d) => s + d * (counts[d] || 0), 0);

/* ================= crypto helpers ================= */

const bufToB64 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const b64ToBuf = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('mc-keystore', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('keys');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const keyOp = (db, mode, fn) => new Promise((resolve, reject) => {
  const r = fn(db.transaction('keys', mode).objectStore('keys'));
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

async function getKey() {
  // Prefer a non-extractable AES key persisted as a CryptoKey in IndexedDB:
  // the page can use it to encrypt/decrypt, but no script (ours included) can read the raw key.
  const db = await idb();
  try {
    const existing = await keyOp(db, 'readonly', (s) => s.get('aes'));
    if (existing) return existing;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await keyOp(db, 'readwrite', (s) => s.put(key, 'aes'));
    return key;
  } catch {
    // Fallback for browsers that can't persist CryptoKey objects.
    const raw = localStorage.getItem(KEK_KEY);
    if (raw) return crypto.subtle.importKey('raw', b64ToBuf(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    localStorage.setItem(KEK_KEY, bufToB64(new Uint8Array(await crypto.subtle.exportKey('raw', key))));
    return key;
  }
}

async function encryptJSON(obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, data));
  return { enc: 'AES-GCM', iv: bufToB64(iv), ct: bufToB64(ct) };
}

async function decryptJSON(payload) {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBuf(payload.iv) },
    cryptoKey,
    b64ToBuf(payload.ct)
  );
  return JSON.parse(new TextDecoder().decode(pt));
}

/* ================= persistence ================= */

function save() {
  if (!state) return;
  try {
    if (hasSubtle && cryptoKey) {
      encryptJSON(state)
        .then((p) => localStorage.setItem(STORAGE_KEY, JSON.stringify(p)))
        .catch((e) => console.warn('Save failed', e));
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ enc: 'none', plain: state }));
    }
  } catch (e) {
    console.warn('Save failed', e);
  }
}

async function load() {
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch {}
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw);
    if (payload.enc === 'none') return payload.plain;
    if (hasSubtle && cryptoKey) return await decryptJSON(payload);
  } catch (e) {
    console.warn('Stored data unreadable', e);
  }
  return null;
}

function normalize(s) {
  const base = freshState();
  if (!s || typeof s !== 'object') return base;
  const counts = (src) => {
    const c = emptyCounts();
    DENOMS.forEach((d) => {
      const n = Number(src ? src[d] : NaN);
      c[d] = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
    });
    return c;
  };
  return {
    v: 1,
    current: {
      startedAt: Number(s.current && s.current.startedAt) || Date.now(),
      counts: counts(s.current && s.current.counts),
    },
    history: Array.isArray(s.history)
      ? s.history.map((h) => ({
          startedAt: Number(h && h.startedAt) || 0,
          endedAt: Number(h && h.endedAt) || 0,
          counts: counts(h && h.counts),
        }))
      : [],
  };
}

/* ================= dom refs ================= */

const els = {
  total: $('total'),
  sessionInfo: $('session-info'),
  notes: $('notes'),
  finish: $('finish'),
  edgeHint: $('edge-hint'),
  scrim: $('scrim'),
  drawer: $('drawer'),
  historyList: $('history-list'),
  viewList: $('view-list'),
  viewDetail: $('view-detail'),
  detailTitle: $('detail-title'),
  sessionDetail: $('session-detail'),
  backBtn: $('back-btn'),
  closeDrawer: $('close-drawer'),
  finishModal: $('finish-modal'),
  finishRows: $('finish-rows'),
  finishTotal: $('finish-total'),
  finishClose: $('finish-close'),
  ok: $('ok'),
  ctxMenu: $('ctx-menu'),
  ctxDelete: $('ctx-delete'),
  historyBtn: $('history-btn'),
};

const finishOpen = () => els.finishModal.classList.contains('show');

/* ================= main screen ================= */

const noteCnt = {}; // denom -> count element

function buildNotes() {
  DENOMS.forEach((d) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `note note-${d}`;
    btn.setAttribute('aria-label', `€${d} note — tap to add, hold to remove`);

    const val = document.createElement('span');
    val.className = 'val';
    val.textContent = '€' + d;

    const cnt = document.createElement('span');
    cnt.className = 'cnt';
    noteCnt[d] = cnt;

    btn.append(val, cnt);
    els.notes.append(btn);
    bindNote(btn, d);
  });
  els.notes.addEventListener('contextmenu', (e) => e.preventDefault());
}

function renderMain() {
  const c = state.current;
  els.total.textContent = '€' + fmt(totalOf(c.counts));
  els.sessionInfo.textContent = 'Session since ' + fmtDate(c.startedAt);
  DENOMS.forEach((d) => {
    const n = c.counts[d] || 0;
    noteCnt[d].textContent = '× ' + n;
    noteCnt[d].classList.toggle('has', n > 0);
  });
}

function adjust(d, delta) {
  const c = state.current;
  const next = Math.max(0, (c.counts[d] || 0) + delta);
  if (next === c.counts[d]) return; // never below zero
  c.counts[d] = next;
  renderMain();
  save();
}

function bindNote(btn, d) {
  let holdTimer = null;
  let holdFired = false;
  let active = false;
  let x0 = 0, y0 = 0;

  const clearHold = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };

  btn.addEventListener('pointerdown', (e) => {
    if (finishOpen()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    x0 = e.clientX; y0 = e.clientY;
    active = true;
    holdFired = false;
    clearHold();
    holdTimer = setTimeout(() => {
      holdFired = true;
      active = false;
      adjust(d, -1);
      vibrate(25);
    }, HOLD_MS);
  });

  btn.addEventListener('pointermove', (e) => {
    if (!active) return;
    if (Math.hypot(e.clientX - x0, e.clientY - y0) > TAP_SLOP) { active = false; clearHold(); }
  });

  btn.addEventListener('pointerup', () => {
    clearHold();
    if (!active || holdFired) { active = false; return; }
    active = false;
    adjust(d, +1);
    vibrate(12);
  });

  btn.addEventListener('pointercancel', clearHold);
}

/* ================= history drawer ================= */

let drawerOpen = false;
let drawerW = 0;

function setDrawer(px, animate) {
  drawerW = drawerW || els.drawer.offsetWidth;
  px = Math.max(0, Math.min(drawerW, px));
  els.drawer.classList.toggle('dragging', !animate);
  if (animate) {
    els.drawer.style.transform = '';
    els.scrim.style.opacity = '';
    els.drawer.classList.toggle('open', px === drawerW);
    els.scrim.classList.toggle('show', px === drawerW);
  } else {
    els.drawer.style.transform = `translateX(${px - drawerW}px)`;
    els.scrim.classList.add('show');
    els.scrim.style.opacity = String(px / drawerW);
  }
  drawerOpen = px === drawerW;
}

function openDrawer() {
  drawerW = els.drawer.offsetWidth;
  renderHistoryList();
  showListView();
  setDrawer(drawerW, true);
}

function closeDrawer() {
  closeCtxMenu();
  setDrawer(0, true);
}

function showListView() {
  els.viewDetail.style.display = 'none';
  els.viewList.style.display = '';
}

function showDetailView() {
  els.viewList.style.display = 'none';
  els.viewDetail.style.display = '';
}

let drag = null; // { x0, y0, mode: 'open'|'close', engaged, lastX }

document.addEventListener('pointerdown', (e) => {
  if (finishOpen()) { drag = null; return; }
  drawerW = els.drawer.offsetWidth || 1;
  if (drawerOpen) {
    if (e.clientX <= drawerW) drag = { x0: e.clientX, y0: e.clientY, mode: 'close', engaged: false, lastX: e.clientX };
  } else if (e.clientX <= EDGE_PX) {
    drag = { x0: e.clientX, y0: e.clientY, mode: 'open', engaged: false, lastX: e.clientX };
  } else {
    drag = null;
  }
});

document.addEventListener('pointermove', (e) => {
  if (!drag) return;
  drag.lastX = e.clientX;
  if (!drag.engaged) {
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (Math.abs(dx) > 24 && Math.abs(dx) > Math.abs(dy)) {
      drag.engaged = true;
      if (drag.mode === 'open') { renderHistoryList(); showListView(); }
    } else {
      return;
    }
  }
  const dx = e.clientX - drag.x0;
  setDrawer(drag.mode === 'open' ? dx : drawerW + dx, false);
});

document.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x0;
  if (drag.engaged) {
    const px = drag.mode === 'open' ? dx : drawerW + dx;
    const target = px > drawerW * 0.5 ? drawerW : 0;
    setDrawer(target, true);
  }
  drag = null;
});

document.addEventListener('pointercancel', () => {
  if (drag && drag.engaged) {
    const px = drag.mode === 'open' ? (drag.lastX - drag.x0) : (drawerW + drag.lastX - drag.x0);
    setDrawer(px > drawerW * 0.5 ? drawerW : 0, true);
  }
  drag = null;
});

els.scrim.addEventListener('click', closeDrawer);
els.closeDrawer.addEventListener('click', closeDrawer);
els.edgeHint.addEventListener('click', () => { if (!drawerOpen) openDrawer(); });
els.historyBtn.addEventListener('click', () => { if (!drawerOpen) openDrawer(); });
els.backBtn.addEventListener('click', showListView);

/* ================= session context menu (delete) ================= */

let ctxTarget = null; // the history session the menu is acting on

function openCtxMenu(x, y, session) {
  ctxTarget = session;
  els.ctxMenu.classList.add('open');
  const rect = els.ctxMenu.getBoundingClientRect();
  els.ctxMenu.style.left = Math.max(8, Math.min(window.innerWidth - rect.width - 8, x)) + 'px';
  els.ctxMenu.style.top = Math.max(8, Math.min(window.innerHeight - rect.height - 8, y)) + 'px';
  vibrate(25);
}

function closeCtxMenu() {
  els.ctxMenu.classList.remove('open');
  ctxTarget = null;
}

els.ctxDelete.addEventListener('click', () => {
  if (!ctxTarget) return;
  const i = state.history.indexOf(ctxTarget);
  if (i !== -1) state.history.splice(i, 1);
  save();
  closeCtxMenu();
  renderHistoryList();
});

// Any press outside the menu closes it (capture phase, before other handlers)
document.addEventListener('pointerdown', (e) => {
  if (els.ctxMenu.classList.contains('open') && !els.ctxMenu.contains(e.target)) closeCtxMenu();
}, true);

/* ================= history views ================= */

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(ts) {
  const d = new Date(ts);
  if (d.toDateString() !== new Date().toDateString()) {
    return d.toLocaleDateString('en-IE', { day: 'numeric', month: 'short' }) + ', ' + fmtTime(ts);
  }
  return fmtTime(ts);
}

function fmtFull(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' + fmtTime(ts);
}

function fmtRange(start, end) {
  const a = new Date(start), b = new Date(end);
  return fmtFull(start) + ' → ' + (a.toDateString() === b.toDateString() ? fmtTime(end) : fmtFull(end));
}

// Tap opens the session detail; long-press (touch) or right-click (mouse)
// opens the context menu with a Delete option.
function bindHistoryItem(btn, s) {
  let holdTimer = null;
  let x0 = 0, y0 = 0;
  const clearHold = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };

  btn.title = 'Long-press / right-click for options';

  btn.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return; // right-click goes via contextmenu
    delete btn.dataset.suppress; // clear stale suppression from a previous press
    x0 = e.clientX; y0 = e.clientY;
    clearHold();
    holdTimer = setTimeout(() => {
      btn.dataset.suppress = '1'; // eat the click that follows the hold
      openCtxMenu(x0, y0, s);
    }, HOLD_MS);
  });

  btn.addEventListener('pointermove', (e) => {
    if (Math.hypot(e.clientX - x0, e.clientY - y0) > TAP_SLOP) clearHold();
  });

  btn.addEventListener('pointerup', clearHold);
  btn.addEventListener('pointercancel', clearHold);

  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    clearHold();
    if (ctxTarget === s && els.ctxMenu.classList.contains('open')) return; // hold already opened it
    btn.dataset.suppress = '1';
    openCtxMenu(e.clientX, e.clientY, s);
  });

  btn.addEventListener('click', () => {
    if (btn.dataset.suppress) { delete btn.dataset.suppress; return; }
    showSession(s);
  });
}

function renderHistoryList() {
  els.historyList.replaceChildren();
  if (!state.history.length) {
    const li = document.createElement('li');
    li.className = 'hist-empty';
    li.textContent = 'No finished sessions yet.';
    els.historyList.append(li);
    return;
  }
  [...state.history].reverse().forEach((s) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hist-item';

    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = fmtFull(s.startedAt);

    const amount = document.createElement('span');
    amount.className = 'amount';
    amount.textContent = '€' + fmt(totalOf(s.counts));

    btn.append(when, amount);
    bindHistoryItem(btn, s);
    li.append(btn);
    els.historyList.append(li);
  });
}

function showSession(s) {
  els.detailTitle.textContent = fmtFull(s.startedAt);
  els.sessionDetail.replaceChildren(breakdownDOM(s.counts, { range: s }));
  showDetailView();
}

/* ================= breakdown DOM ================= */

function breakdownDOM(counts, opts) {
  const { range = null, withTotal = true } = opts || {};
  const frag = document.createDocumentFragment();

  if (range) {
    const p = document.createElement('div');
    p.className = 'detail-range';
    p.textContent = fmtRange(range.startedAt, range.endedAt);
    frag.append(p);
  }

  const used = DENOMS.filter((d) => counts[d] > 0);
  if (!used.length) {
    const p = document.createElement('div');
    p.className = 'nothing';
    p.textContent = 'Nothing counted.';
    frag.append(p);
  } else {
    used.forEach((d) => {
      const r = document.createElement('div');
      r.className = 'row';
      const a = document.createElement('span');
      a.textContent = `€${d} × ${counts[d]}`;
      const b = document.createElement('span');
      b.textContent = '€' + fmt(d * counts[d]);
      r.append(a, b);
      frag.append(r);
    });
  }

  if (withTotal) {
    const gt = document.createElement('div');
    gt.className = 'grand-total';
    const l = document.createElement('span');
    l.textContent = 'Total';
    const v = document.createElement('span');
    v.textContent = '€' + fmt(totalOf(counts));
    gt.append(l, v);
    frag.append(gt);
  }

  return frag;
}

/* ================= finish flow ================= */

els.finish.addEventListener('click', () => {
  els.finishRows.replaceChildren(breakdownDOM(state.current.counts, { withTotal: false }));
  els.finishTotal.textContent = '€' + fmt(totalOf(state.current.counts));
  els.finishModal.classList.add('show');
});

els.finishClose.addEventListener('click', () => els.finishModal.classList.remove('show'));

els.ok.addEventListener('click', () => {
  const c = state.current;
  state.history.push({ startedAt: c.startedAt, endedAt: Date.now(), counts: { ...c.counts } });
  state.current = { startedAt: Date.now(), counts: emptyCounts() };
  save();
  els.finishModal.classList.remove('show');
  renderMain();
  vibrate(20);
});

/* ================= init ================= */

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const host = location.hostname;
  const ok = location.protocol === 'https:' ||
    (location.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1'));
  if (!ok) return;
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
}

(async function init() {
  buildNotes();
  try {
    if (hasSubtle && typeof indexedDB !== 'undefined') cryptoKey = await getKey();
  } catch (e) {
    console.warn('Encryption unavailable', e);
  }
  state = normalize(await load());
  renderMain();
  save(); // persist the (possibly brand-new) session so it survives app restarts
  registerSW();
})();
