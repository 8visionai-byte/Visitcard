// POST /api/scan — proxy do Claude API (vision + structured outputs).
// Klucz ANTHROPIC_API_KEY wyłącznie w zmiennych środowiskowych (Vercel / lokalny env).
// Opcjonalnie SCAN_PIN: gdy ustawiony, żądanie musi mieć nagłówek x-scan-pin o tej wartości.
// UWAGA: prompt i schema mają swoją kopię w app.js (tryb "własny klucz") — zmiany trzymać w synchronizacji.

const ALLOWED_MODELS = ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'];
const DEFAULT_MODEL = 'claude-opus-4-8';
const MAX_IMAGE_BASE64 = 3_500_000; // ~2,6 MB obrazu; frontend kompresuje do ~1568 px

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

async function readJsonBody(req) {
  if (req.body !== undefined) {
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function send(res, status, obj) {
  if (typeof res.status === 'function') {
    res.status(status).json(obj);
  } else {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  }
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'POST') return send(res, 405, { error: 'Tylko POST' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return send(res, 500, { error: 'Serwer nie ma skonfigurowanego ANTHROPIC_API_KEY (zmienna środowiskowa).' });
  }

  const pin = process.env.SCAN_PIN;
  if (pin && req.headers['x-scan-pin'] !== pin) {
    return send(res, 401, { error: 'Nieprawidłowy PIN.' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return send(res, 400, { error: 'Nieprawidłowy JSON w żądaniu.' });
  }

  const { image, mediaType, model } = body || {};
  if (!image || typeof image !== 'string') return send(res, 400, { error: 'Brak obrazu (pole image, base64).' });
  if (image.length > MAX_IMAGE_BASE64) return send(res, 413, { error: 'Obraz za duży. Skompresuj zdjęcie.' });

  const useModel = ALLOWED_MODELS.includes(model) ? model : DEFAULT_MODEL;
  const useMediaType = ['image/jpeg', 'image/png', 'image/webp'].includes(mediaType) ? mediaType : 'image/jpeg';

  // Kto skanuje (widoczne w logach funkcji na Vercelu)
  let userEmail = 'anonim';
  try { userEmail = decodeURIComponent(req.headers['x-user-email'] || '') || 'anonim'; } catch { /* zostaje anonim */ }
  console.log('[skan]', userEmail, useModel);

  let apiRes;
  try {
    apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: useModel,
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: useMediaType, data: image } },
            { type: 'text', text: PROMPT },
          ],
        }],
        output_config: { format: { type: 'json_schema', schema: CONTACT_SCHEMA } },
      }),
    });
  } catch (e) {
    return send(res, 502, { error: 'Brak połączenia z API Anthropic: ' + e.message });
  }

  const data = await apiRes.json().catch(() => null);
  if (!apiRes.ok) {
    const msg = data && data.error && data.error.message ? data.error.message : ('HTTP ' + apiRes.status);
    return send(res, 502, { error: 'Claude API: ' + msg });
  }
  if (data.stop_reason === 'refusal') {
    return send(res, 502, { error: 'Model odmówił przetworzenia tego obrazu. Spróbuj zrobić zdjęcie ponownie.' });
  }

  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) return send(res, 502, { error: 'Pusta odpowiedź modelu.' });

  let contact;
  try {
    contact = JSON.parse(textBlock.text);
  } catch {
    return send(res, 502, { error: 'Model zwrócił niepoprawny JSON.' });
  }

  return send(res, 200, { contact, model: data.model, usage: data.usage });
};
