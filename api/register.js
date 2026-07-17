// POST /api/register — rejestracja użytkownika aplikacji (imię + e-mail).
// Zapisuje wpis w logach serwera (Vercel: Deployments -> Functions -> Logs).
// Opcjonalnie REGISTER_WEBHOOK_URL (env): każda rejestracja poleci POST-em na webhook
// (np. scenariusz Make -> wiersz w Google Sheets), payload: {imie, email, data, userAgent}.

function send(res, status, obj) {
  if (typeof res.status === 'function') {
    res.status(status).json(obj);
  } else {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  }
}

async function readJsonBody(req) {
  if (req.body !== undefined) {
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'Tylko POST' });

  let body;
  try { body = await readJsonBody(req); }
  catch { return send(res, 400, { error: 'Nieprawidłowy JSON.' }); }

  const imie = String(body.imie || '').trim().slice(0, 80);
  const email = String(body.email || '').trim().toLowerCase().slice(0, 160);
  if (imie.length < 2 || !EMAIL_RE.test(email)) {
    return send(res, 400, { error: 'Wymagane: imię i poprawny e-mail.' });
  }

  const entry = {
    imie,
    email,
    data: new Date().toISOString(),
    userAgent: String(body.userAgent || '').slice(0, 300),
  };
  console.log('[rejestracja]', JSON.stringify(entry));

  const webhook = process.env.REGISTER_WEBHOOK_URL;
  if (webhook) {
    try {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(entry),
      });
    } catch (e) {
      console.log('[rejestracja] webhook niedostępny:', e.message);
    }
  }

  return send(res, 200, { ok: true });
};
