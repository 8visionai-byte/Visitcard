/* Skaner Wizytówek — logika aplikacji.
   Przepływ: rejestracja (imię + e-mail) -> aparat na żywo z ramką (albo zdjęcie z galerii)
   -> kompresja (canvas, maks. 1568 px) -> ekstrakcja przez /api/scan (klucz tylko na serwerze)
   -> formularz korekty -> IndexedDB -> vCard / CSV. */
'use strict';

/* ===================== Stan lokalny ===================== */
const USER_KEY = 'wizytownik.user';
const USAGE_KEY = 'wizytownik.usage';

function loadUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
  catch { return null; }
}
function saveUser(u) { localStorage.setItem(USER_KEY, JSON.stringify(u)); }

function getUsage() {
  try { return JSON.parse(localStorage.getItem(USAGE_KEY) || '{"scans":0}'); }
  catch { return { scans: 0 }; }
}
function addScan() {
  const u = getUsage();
  u.scans = (u.scans || 0) + 1;
  localStorage.setItem(USAGE_KEY, JSON.stringify(u));
}

/* ===================== Ekstrakcja (serwer /api/scan) ===================== */
async function extractContact(base64, mediaType) {
  const headers = { 'content-type': 'application/json' };
  const user = loadUser();
  if (user) {
    headers['x-user-email'] = encodeURIComponent(user.email);
    headers['x-user-name'] = encodeURIComponent(user.imie);
  }
  headers['x-scans-used'] = String(getUsage().scans || 0);
  const res = await fetch('api/scan', {
    method: 'POST', headers,
    body: JSON.stringify({ image: base64, mediaType }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data && data.error ? data.error : 'HTTP ' + res.status);
  }
  return data.contact;
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
const IS_MOBILE = IS_IOS || /Android/.test(navigator.userAgent);
async function deliverFile(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const file = new File([blob], filename, { type: mime });
  // Na telefonie arkusz udostępniania to najkrótsza droga do Kontaktów
  if (IS_MOBILE && navigator.canShare && navigator.canShare({ files: [file] })) {
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

/* Wyszukiwanie: bez wielkości liter, bez polskich ogonków (na telefonie rzadko się je pisze)
   i bez separatorów w numerach, żeby "601234567" znalazło "+48 601 234 567". */
function normalizeText(v) {
  return String(v == null ? '' : v)
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD').replace(/\p{Mn}/gu, ''); // usuwa ogonki i kreski (ą->a, ś->s)
}

/* Indeks wyszukiwania = WSZYSTKIE pola kontaktu (łącznie z notatkami, NIP-em i adresem).
   Przy dodaniu nowego pola do kontaktu dopisz je tutaj. */
function searchIndex(c) {
  const parts = [
    c.imie, c.nazwisko, c.firma, c.stanowisko,
    ...(c.telefony || []), ...(c.emaile || []), ...(c.www || []),
    c.ulica, c.kod_pocztowy, c.miasto, c.kraj, c.nip, c.notatki,
  ];
  const text = normalizeText(parts.filter(Boolean).join(' '));
  // Osobny indeks samych cyfr: "601234567" znajdzie "+48 601 234 567", a NIP działa
  // niezależnie od myślników. Trzymany osobno, żeby litery nie sklejały się w fałszywe trafienia.
  return { text, digits: text.replace(/\D/g, '') };
}

async function renderList() {
  const all = (await dbAll()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const q = normalizeText($('#search').value.trim());
  const qDigits = q.replace(/\D/g, '');
  const szukajPoCyfrach = qDigits.length >= 3 && !/[a-z]/.test(q); // zapytanie wygląda na numer
  const filtered = !q ? all : all.filter((c) => {
    const idx = searchIndex(c);
    return idx.text.includes(q) || (szukajPoCyfrach && idx.digits.includes(qDigits));
  });

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

    if (c.notatki) {
      const note = document.createElement('div');
      note.className = 'row-note';
      note.textContent = c.notatki;
      body.append(note);
    }

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
    addScan();
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

/* ===================== Skaner: aparat na żywo z ramką ===================== */
let camStream = null;

async function openScanner() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $('#fileInput').click();
    return;
  }
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    $('#camVideo').srcObject = camStream;
    showModal('modalScanner');
  } catch {
    // brak aparatu albo brak zgody: klasyczny wybór zdjęcia
    $('#fileInput').click();
  }
}

function closeScanner() {
  if (camStream) {
    camStream.getTracks().forEach((t) => t.stop());
    camStream = null;
  }
  $('#camVideo').srcObject = null;
  hideModal('modalScanner');
}

async function captureFromCamera() {
  const video = $('#camVideo');
  const guide = document.querySelector('.scan-guide');
  const sw = video.videoWidth, sh = video.videoHeight;
  if (!sw || !sh) return;

  // Wideo wypełnia ekran w trybie "cover" — przelicz ramkę z ekranu na piksele źródła.
  const vr = video.getBoundingClientRect();
  const gr = guide.getBoundingClientRect();
  const scale = Math.max(vr.width / sw, vr.height / sh);
  const srcX = (sw - vr.width / scale) / 2;
  const srcY = (sh - vr.height / scale) / 2;

  const pad = 0.05; // niewielki margines wokół ramki
  let cx = srcX + (gr.left - vr.left) / scale;
  let cy = srcY + (gr.top - vr.top) / scale;
  let cw = gr.width / scale;
  let ch = gr.height / scale;
  cx -= cw * pad; cy -= ch * pad; cw *= 1 + 2 * pad; ch *= 1 + 2 * pad;
  cx = Math.max(0, cx); cy = Math.max(0, cy);
  cw = Math.min(cw, sw - cx); ch = Math.min(ch, sh - cy);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cw);
  canvas.height = Math.round(ch);
  canvas.getContext('2d').drawImage(video, cx, cy, cw, ch, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
  closeScanner();
  handleFile(blob);
}

/* Jednorazowa prośba o dostęp do aparatu zaraz po rejestracji (zgoda jest zapamiętywana). */
async function warmUpCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    s.getTracks().forEach((t) => t.stop());
    toast('Aparat gotowy. Kliknij "Skanuj wizytówkę".');
  } catch { /* odmowa — zostaje wybór zdjęcia z galerii */ }
}

/* ===================== Instalacja PWA ===================== */
let deferredInstall = null;
const IS_STANDALONE = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function refreshInstallUi() {
  const canPrompt = Boolean(deferredInstall);
  const showAnything = !IS_STANDALONE;
  $('#btnInstallBanner').classList.toggle('hidden', !showAnything || (!canPrompt && !IS_MOBILE));
  $('#btnInstall').classList.toggle('hidden', !showAnything);
}

async function installApp() {
  if (deferredInstall) {
    deferredInstall.prompt();
    const choice = await deferredInstall.userChoice.catch(() => null);
    deferredInstall = null;
    refreshInstallUi();
    if (choice && choice.outcome === 'accepted') toast('Aplikacja instaluje się na telefonie.');
    return;
  }
  if (IS_STANDALONE) { toast('Aplikacja jest już zainstalowana.'); return; }
  // iPhone (brak automatycznej instalacji) albo przeglądarka bez beforeinstallprompt
  $('#installStepsIos').classList.toggle('hidden', !IS_IOS);
  $('#installStepsAndroid').classList.toggle('hidden', IS_IOS);
  showModal('modalInstall');
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
    refreshInstallUi();
    warmUpCamera(); // jednorazowa zgoda na aparat od razu po wejściu
  });

  $('#scanBar').addEventListener('click', openScanner);
  $('#btnShutter').addEventListener('click', captureFromCamera);
  $('#btnScanClose').addEventListener('click', closeScanner);
  $('#btnGallery').addEventListener('click', () => { closeScanner(); $('#fileInput').click(); });

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
    const user = loadUser();
    if (user) $('#settingsUser').textContent = user.imie + ' · ' + user.email;
    $('#connStatus').textContent = '';
    refreshInstallUi();
    showModal('modalSettings');
  });

  $('#btnLogout').addEventListener('click', () => {
    if (!confirm('Wylogować? Kontakty zostaną na tym urządzeniu.')) return;
    localStorage.removeItem(USER_KEY);
    hideModal('modalSettings');
    applyGate();
  });

  $('#btnInstall').addEventListener('click', installApp);
  $('#btnInstallBanner').addEventListener('click', installApp);

  $('#btnTestConn').addEventListener('click', async () => {
    const status = $('#connStatus');
    status.textContent = 'Testuję…';
    try {
      // Test na maleńkim obrazku 2x2 px (JPEG) — sprawdza serwer i klucz za grosze.
      const tiny = await tinyJpegBase64();
      const contact = await extractContact(tiny, 'image/jpeg');
      status.textContent = contact ? '✓ Połączenie działa. Można skanować.' : 'Odpowiedź pusta.';
    } catch (err) {
      status.textContent = '✗ ' + err.message;
    }
  });

  document.querySelectorAll('[data-close]').forEach((btn) =>
    btn.addEventListener('click', () => hideModal(btn.dataset.close)));

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    refreshInstallUi();
  });
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
  refreshInstallUi();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});

/* Interfejs diagnostyczny (używany przez testy automatyczne; bezpieczny w produkcji). */
window.__app = { handleFile, buildVCard, buildCsv, dbAll, prepareImages, extractContact, renderList, loadUser, openScanner };
