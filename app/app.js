/* Skaner Wizytówek — logika aplikacji.
   Przepływ: rejestracja (imię + e-mail) -> zdjęcie -> kompresja (canvas, maks. 1568 px)
   -> ekstrakcja (Claude vision + structured outputs, przez /api/scan albo własny klucz)
   -> formularz korekty -> IndexedDB -> vCard / CSV. */
'use strict';

/* ===================== Ustawienia ===================== */
const SETTINGS_KEY = 'wizytownik.settings';
const USER_KEY = 'wizytownik.user';
const DEFAULT_SETTINGS = { mode: 'proxy', apiKey: '', pin: '', model: 'claude-opus-4-8' };

function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

function loadUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
  catch { return null; }
}
function saveUser(u) { localStorage.setItem(USER_KEY, JSON.stringify(u)); }

/* ===================== Ekstrakcja (kopia promptu/schemy z api/scan.js — trzymać w synchronizacji) ===== */
const CONTACT_SCHEMA = {
  type: 'object',
  properties: {
    imie: { type: ['string', 'null'] },
    nazwisko: { type: ['string', 'null'] },
    firma: { type: ['string', 'null'] },
    stanowisko: { type: ['string', 'null'] },
    telefony: { type: 'array', items: { type: 'string' } },
    emaile: { type: 'array', items: { type: 'string' } },
    www: { type: 'array', items: { type: 'string' } },
    ulica: { type: ['string', 'null'] },
    kod_pocztowy: { type: ['string', 'null'] },
    miasto: { type: ['string', 'null'] },
    kraj: { type: ['string', 'null'] },
    nip: { type: ['string', 'null'] },
    notatki: { type: ['string', 'null'] },
  },
  required: ['imie', 'nazwisko', 'firma', 'stanowisko', 'telefony', 'emaile', 'www',
    'ulica', 'kod_pocztowy', 'miasto', 'kraj', 'nip', 'notatki'],
  additionalProperties: false,
};

const PROMPT = [
  'Odczytaj dane kontaktowe z tej wizytówki (możliwe języki: polski, angielski, niemiecki).',
  'Zwróć wyłącznie informacje widoczne na wizytówce. Jeśli jakiegoś pola nie ma, zwróć null (dla list: pustą tablicę).',
  'Nie zgaduj i nie uzupełniaj danych z wiedzy ogólnej.',
  'Telefony zapisuj tak, jak są na wizytówce (z kierunkowym, jeśli podany).',
  'Pole nip wypełnij tylko, gdy numer jest jednoznacznie oznaczony jako NIP (nie REGON, nie KRS).',
  'W polu notatki umieść ewentualne dodatkowe informacje z wizytówki (np. godziny, drugi adres, slogan pomiń).',
].join(' ');

async function extractViaProxy(base64, mediaType, settings) {
  const headers = { 'content-type': 'application/json' };
  if (settings.pin) headers['x-scan-pin'] = settings.pin;
  const user = loadUser();
  if (user) {
    headers['x-user-email'] = encodeURIComponent(user.email);
    headers['x-user-name'] = encodeURIComponent(user.imie);
  }
  const res = await fetch('api/scan', {
    method: 'POST', headers,
    body: JSON.stringify({ image: base64, mediaType, model: settings.model }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data && data.error ? data.error : 'HTTP ' + res.status;
    if (res.status === 404) throw new Error('Serwer aplikacji nie ma funkcji /api/scan. W Ustawieniach przełącz tryb na "Własny klucz API".');
    throw new Error(msg);
  }
  return data.contact;
}

async function extractDirect(base64, mediaType, settings) {
  if (!settings.apiKey) throw new Error('Brak klucza API. Wpisz go w Ustawieniach.');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: PROMPT },
        ],
      }],
      output_config: { format: { type: 'json_schema', schema: CONTACT_SCHEMA } },
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data && data.error && data.error.message ? data.error.message : 'HTTP ' + res.status;
    throw new Error('Claude API: ' + msg);
  }
  if (data.stop_reason === 'refusal') throw new Error('Model odmówił przetworzenia obrazu. Zrób zdjęcie ponownie.');
  const block = (data.content || []).find((b) => b.type === 'text');
  if (!block) throw new Error('Pusta odpowiedź modelu.');
  return JSON.parse(block.text);
}

async function extractContact(base64, mediaType) {
  const s = loadSettings();
  return s.mode === 'direct' ? extractDirect(base64, mediaType, s) : extractViaProxy(base64, mediaType, s);
}

/* ===================== Obraz: kompresja i miniatura ===================== */
async function decodeImage(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Nie udało się wczytać zdjęcia.')); };
      img.src = url;
    });
  }
}

function drawScaled(img, maxDim, quality) {
  const w = img.width, h = img.height;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

async function prepareImages(file) {
  const img = await decodeImage(file);
  const [mainBlob, thumbBlob] = await Promise.all([
    drawScaled(img, 1568, 0.85),
    drawScaled(img, 420, 0.7),
  ]);
  const mainDataUrl = await blobToDataUrl(mainBlob);
  const thumbDataUrl = await blobToDataUrl(thumbBlob);
  return { base64: mainDataUrl.split(',')[1], mediaType: 'image/jpeg', thumb: thumbDataUrl };
}

/* ===================== Baza (IndexedDB) ===================== */
const DB_NAME = 'wizytownik', DB_STORE = 'kontakty';
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbOp(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, mode);
    const out = fn(tx.objectStore(DB_STORE));
    tx.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}
const dbPut = (c) => dbOp('readwrite', (s) => s.put(c));
const dbDelete = (id) => dbOp('readwrite', (s) => s.delete(id));
async function dbAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/* ===================== vCard 3.0 ===================== */
function vEsc(v) {
  return String(v || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function buildVCard(c) {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
  lines.push(`N:${vEsc(c.nazwisko)};${vEsc(c.imie)};;;`);
  lines.push(`FN:${vEsc([c.imie, c.nazwisko].filter(Boolean).join(' ') || c.firma || 'Kontakt z wizytówki')}`);
  if (c.firma) lines.push(`ORG:${vEsc(c.firma)}`);
  if (c.stanowisko) lines.push(`TITLE:${vEsc(c.stanowisko)}`);
  (c.telefony || []).forEach((t, i) => lines.push(`TEL;TYPE=${i === 0 ? 'CELL' : 'WORK'}:${vEsc(t)}`));
  (c.emaile || []).forEach((e) => lines.push(`EMAIL;TYPE=INTERNET:${vEsc(e)}`));
  (c.www || []).forEach((u) => lines.push(`URL:${vEsc(u)}`));
  if (c.ulica || c.miasto || c.kod_pocztowy || c.kraj) {
    lines.push(`ADR;TYPE=WORK:;;${vEsc(c.ulica)};${vEsc(c.miasto)};;${vEsc(c.kod_pocztowy)};${vEsc(c.kraj)}`);
  }
  const noteParts = [];
  if (c.nip) noteParts.push('NIP: ' + c.nip);
  if (c.notatki) noteParts.push(c.notatki);
  if (noteParts.length) lines.push(`NOTE:${vEsc(noteParts.join(' | '))}`);
  lines.push('REV:' + new Date().toISOString());
  lines.push('END:VCARD');
  return lines.join('\r\n') + '\r\n';
}

/* ===================== CSV (średnik + BOM, polski Excel) ===================== */
const CSV_HEADER = ['Imię', 'Nazwisko', 'Firma', 'Stanowisko', 'Telefon 1', 'Telefon 2',
  'E-mail 1', 'E-mail 2', 'WWW', 'Ulica', 'Kod pocztowy', 'Miasto', 'Kraj', 'NIP', 'Notatki', 'Data skanu'];
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function buildCsv(contacts) {
  const rows = [CSV_HEADER];
  for (const c of contacts) {
    rows.push([
      c.imie, c.nazwisko, c.firma, c.stanowisko,
      (c.telefony || [])[0], (c.telefony || [])[1],
      (c.emaile || [])[0], (c.emaile || [])[1],
      (c.www || []).join(' '),
      c.ulica, c.kod_pocztowy, c.miasto, c.kraj, c.nip, c.notatki,
      c.createdAt ? new Date(c.createdAt).toLocaleString('pl-PL') : '',
    ]);
  }
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

/* ===================== Pobieranie / udostępnianie plików ===================== */
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
async function deliverFile(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const file = new File([blob], filename, { type: mime });
  if (IS_IOS && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 15000);
}
function safeFilename(s) {
  return (s || 'kontakt').normalize('NFD').replace(/[̀-̟]/g, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'kontakt';
}

/* ===================== UI ===================== */
const $ = (sel) => document.querySelector(sel);
let editingContact = null; // kontakt aktualnie w formularzu (nowy lub edytowany)

function toast(msg, opts = {}) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', Boolean(opts.error));
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), opts.ms || (opts.error ? 6000 : 3400));
}
function showModal(id) { $('#' + id).classList.remove('hidden'); }
function hideModal(id) { $('#' + id).classList.add('hidden'); }

function setScanBusy(busy) {
  $('#scanBar').classList.toggle('busy', busy);
  $('#scanLabel').textContent = busy ? 'Odczyt…' : 'Skanuj wizytówkę';
}

function contactTitle(c) {
  return [c.imie, c.nazwisko].filter(Boolean).join(' ') || c.firma || '(bez nazwy)';
}

const PLACEHOLDER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">'
  + '<rect x="3" y="6" width="18" height="12"/><path d="M6.5 10h5M6.5 13.5h8"/></svg>';

async function renderList() {
  const all = (await dbAll()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const q = $('#search').value.trim().toLowerCase();
  const filtered = !q ? all : all.filter((c) =>
    JSON.stringify([c.imie, c.nazwisko, c.firma, c.stanowisko, c.telefony, c.emaile, c.miasto])
      .toLowerCase().includes(q));

  $('#contactCount').textContent = 'N° ' + String(all.length).padStart(3, '0');
  const user = loadUser();
  $('#userLabel').textContent = user ? user.imie : '';

  const ol = $('#contactList');
  ol.innerHTML = '';
  $('#emptyState').classList.toggle('hidden', all.length > 0);

  filtered.forEach((c, idx) => {
    const li = document.createElement('li');
    li.className = 'row';

    const no = document.createElement('span');
    no.className = 'row-no';
    no.textContent = String(filtered.length - idx).padStart(3, '0');

    let thumb;
    if (c.thumb) {
      thumb = Object.assign(document.createElement('img'), { className: 'row-thumb', src: c.thumb, alt: '' });
    } else {
      thumb = document.createElement('div');
      thumb.className = 'row-thumb placeholder';
      thumb.innerHTML = PLACEHOLDER_SVG;
    }

    const body = document.createElement('div');
    body.className = 'row-body';
    const name = document.createElement('div');
    name.className = 'row-name';
    name.textContent = contactTitle(c);
    const meta = document.createElement('div');
    meta.className = 'row-meta';
    meta.textContent = [c.stanowisko, c.firma].filter(Boolean).join(' · ');
    const data = document.createElement('div');
    data.className = 'row-data';
    data.textContent = [(c.telefony || [])[0], (c.emaile || [])[0]].filter(Boolean).join(' · ');
    body.append(name, meta, data);

    const actions = document.createElement('div');
    actions.className = 'row-actions';
    const btnV = Object.assign(document.createElement('button'), { className: 'btn-chip', textContent: 'Do telefonu ↓' });
    btnV.onclick = () => deliverFile(safeFilename(contactTitle(c)) + '.vcf', 'text/vcard;charset=utf-8', buildVCard(c));
    const btnE = Object.assign(document.createElement('button'), { className: 'btn-text', textContent: 'Edytuj' });
    btnE.onclick = () => openEditForm(c, 'Korekta');
    const btnD = Object.assign(document.createElement('button'), { className: 'btn-text danger', textContent: 'Usuń' });
    btnD.onclick = async () => {
      if (confirm('Usunąć kontakt: ' + contactTitle(c) + '?')) { await dbDelete(c.id); renderList(); toast('Kontakt usunięty.'); }
    };
    actions.append(btnV, btnE, btnD);

    li.append(no, thumb, body, actions);
    ol.append(li);
  });
}

function openEditForm(contact, title) {
  editingContact = contact;
  $('#editTitle').textContent = title;
  const f = $('#editForm');
  f.imie.value = contact.imie || '';
  f.nazwisko.value = contact.nazwisko || '';
  f.firma.value = contact.firma || '';
  f.stanowisko.value = contact.stanowisko || '';
  f.telefony.value = (contact.telefony || []).join('\n');
  f.emaile.value = (contact.emaile || []).join('\n');
  f.www.value = (contact.www || []).join('\n');
  f.ulica.value = contact.ulica || '';
  f.kod_pocztowy.value = contact.kod_pocztowy || '';
  f.miasto.value = contact.miasto || '';
  f.kraj.value = contact.kraj || '';
  f.nip.value = contact.nip || '';
  f.notatki.value = contact.notatki || '';
  const photo = $('#editPhoto');
  if (contact.thumb) { photo.src = contact.thumb; photo.classList.remove('hidden'); }
  else photo.classList.add('hidden');
  showModal('modalEdit');
}

const splitLines = (v) => v.split('\n').map((s) => s.trim()).filter(Boolean);

async function handleFile(file) {
  if (!file) return;
  setScanBusy(true);
  $('#busyText').textContent = 'Odczyt danych…';
  showModal('modalBusy');
  try {
    const { base64, mediaType, thumb } = await prepareImages(file);
    const extracted = await extractContact(base64, mediaType);
    hideModal('modalBusy');
    setScanBusy(false);
    openEditForm({
      id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      ...extracted,
      thumb,
      createdAt: Date.now(),
    }, 'Korekta');
  } catch (e) {
    hideModal('modalBusy');
    setScanBusy(false);
    toast('Błąd: ' + e.message, { error: true });
  }
}

/* ===================== Rejestracja użytkownika ===================== */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function applyGate() {
  const user = loadUser();
  $('#viewGate').classList.toggle('hidden', Boolean(user));
  $('#viewApp').classList.toggle('hidden', !user);
  if (user) {
    $('#userLabel').textContent = user.imie;
    $('#settingsUser').textContent = user.imie + ' · ' + user.email;
  }
}

async function registerUser(imie, email) {
  saveUser({ imie, email, registeredAt: new Date().toISOString() });
  // Powiadomienie serwera (najlepsze podejście: nie blokuje startu, błędy ignorowane)
  try {
    await fetch('api/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imie, email, userAgent: navigator.userAgent }),
    });
  } catch { /* offline lub hosting bez funkcji — rejestracja lokalna wystarczy */ }
}

/* ===================== Zdarzenia ===================== */
function bindEvents() {
  $('#gateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const imie = f.imie.value.trim();
    const email = f.email.value.trim().toLowerCase();
    const err = $('#gateError');
    if (imie.length < 2) { err.textContent = 'Podaj imię.'; return; }
    if (!EMAIL_RE.test(email)) { err.textContent = 'Podaj poprawny adres e-mail.'; return; }
    err.textContent = '';
    await registerUser(imie, email);
    applyGate();
    renderList();
    toast('Witaj, ' + imie + '. Zeskanuj pierwszą wizytówkę.');
  });

  $('#fileInput').addEventListener('change', (e) => {
    handleFile(e.target.files[0]);
    e.target.value = '';
  });

  $('#search').addEventListener('input', renderList);

  $('#editForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const c = {
      ...editingContact,
      imie: f.imie.value.trim() || null,
      nazwisko: f.nazwisko.value.trim() || null,
      firma: f.firma.value.trim() || null,
      stanowisko: f.stanowisko.value.trim() || null,
      telefony: splitLines(f.telefony.value),
      emaile: splitLines(f.emaile.value),
      www: splitLines(f.www.value),
      ulica: f.ulica.value.trim() || null,
      kod_pocztowy: f.kod_pocztowy.value.trim() || null,
      miasto: f.miasto.value.trim() || null,
      kraj: f.kraj.value.trim() || null,
      nip: f.nip.value.trim() || null,
      notatki: f.notatki.value.trim() || null,
    };
    await dbPut(c);
    hideModal('modalEdit');
    await renderList();
    toast('Zapisano. Przycisk "Do telefonu ↓" doda kontakt do telefonu.');
  });

  $('#btnExportCsv').addEventListener('click', async () => {
    const all = (await dbAll()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!all.length) return toast('Brak kontaktów do eksportu.');
    await deliverFile('wizytowki_' + new Date().toISOString().slice(0, 10) + '.csv', 'text/csv;charset=utf-8', buildCsv(all));
  });

  $('#btnExportVcfAll').addEventListener('click', async () => {
    const all = (await dbAll()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!all.length) return toast('Brak kontaktów do eksportu.');
    await deliverFile('wizytowki_wszystkie.vcf', 'text/vcard;charset=utf-8', all.map(buildVCard).join(''));
  });

  $('#btnSettings').addEventListener('click', () => {
    const s = loadSettings();
    const f = $('#settingsForm');
    f.mode.value = s.mode;
    f.apiKey.value = s.apiKey;
    f.pin.value = s.pin;
    f.model.value = s.model;
    toggleSettingsRows(s.mode);
    $('#connStatus').textContent = '';
    const user = loadUser();
    if (user) $('#settingsUser').textContent = user.imie + ' · ' + user.email;
    showModal('modalSettings');
  });

  $('#btnLogout').addEventListener('click', () => {
    if (!confirm('Wylogować? Kontakty zostaną na tym urządzeniu.')) return;
    localStorage.removeItem(USER_KEY);
    hideModal('modalSettings');
    applyGate();
  });

  $('#settingsForm').mode.addEventListener('change', (e) => toggleSettingsRows(e.target.value));

  $('#settingsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    saveSettings({ mode: f.mode.value, apiKey: f.apiKey.value.trim(), pin: f.pin.value.trim(), model: f.model.value });
    hideModal('modalSettings');
    toast('Ustawienia zapisane.');
  });

  $('#btnTestConn').addEventListener('click', async () => {
    const f = $('#settingsForm');
    const s = { mode: f.mode.value, apiKey: f.apiKey.value.trim(), pin: f.pin.value.trim(), model: f.model.value };
    const status = $('#connStatus');
    status.textContent = 'Testuję…';
    try {
      // Test na maleńkim obrazku 2x2 px (JPEG) — sprawdza klucz/PIN/łączność za grosze.
      const tiny = await tinyJpegBase64();
      const contact = s.mode === 'direct' ? await extractDirect(tiny, 'image/jpeg', s) : await extractViaProxy(tiny, 'image/jpeg', s);
      status.textContent = contact ? '✓ Połączenie działa. Można skanować.' : 'Odpowiedź pusta.';
    } catch (err) {
      status.textContent = '✗ ' + err.message;
    }
  });

  document.querySelectorAll('[data-close]').forEach((btn) =>
    btn.addEventListener('click', () => hideModal(btn.dataset.close)));
}

function toggleSettingsRows(mode) {
  $('#rowKey').classList.toggle('hidden', mode !== 'direct');
  $('#rowPin').classList.toggle('hidden', mode !== 'proxy');
}

async function tinyJpegBase64() {
  const canvas = document.createElement('canvas');
  canvas.width = 2; canvas.height = 2;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 2, 2);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
  return (await blobToDataUrl(blob)).split(',')[1];
}

/* ===================== Start ===================== */
window.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  applyGate();
  renderList();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});

/* Interfejs diagnostyczny (używany przez testy automatyczne; bezpieczny w produkcji). */
window.__app = { handleFile, buildVCard, buildCsv, dbAll, prepareImages, extractContact, renderList, loadUser };
