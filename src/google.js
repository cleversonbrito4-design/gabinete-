// Sincronização da agenda com o Google Agenda, direto do navegador.
// Precisa de VITE_GOOGLE_CLIENT_ID (um "ID do cliente OAuth" do Google Cloud).
// A pessoa que conecta precisa ter permissão de edição no calendário do deputado.

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const TZ = import.meta.env.VITE_FUSO || 'America/Sao_Paulo';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const API = 'https://www.googleapis.com/calendar/v3/calendars/';

export const googleAvailable = !!CLIENT_ID;
let token = null, expires = 0, tokenClient = null;

export function calendarId() {
  try { return localStorage.getItem('gabinete-gcal-id') || import.meta.env.VITE_GOOGLE_CALENDAR_ID || 'primary'; }
  catch { return import.meta.env.VITE_GOOGLE_CALENDAR_ID || 'primary'; }
}
export function setCalendarId(id) { try { localStorage.setItem('gabinete-gcal-id', id || ''); } catch { /* ok */ } }
export const isConnected = () => !!token && Date.now() < expires - 60000;

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = ok; s.onerror = () => fail(new Error('Não foi possível carregar o login do Google.'));
    document.head.appendChild(s);
  });
}

/** Abre a janela de autorização do Google (chame a partir de um clique). */
export async function connect() {
  if (!CLIENT_ID) throw new Error('Google Agenda não configurado (falta VITE_GOOGLE_CLIENT_ID).');
  await loadGis();
  return new Promise((ok, fail) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPE,
      callback: r => {
        if (r.error) return fail(new Error('Autorização do Google recusada.'));
        token = r.access_token; expires = Date.now() + (r.expires_in || 3600) * 1000; ok();
      },
      error_callback: () => fail(new Error('A janela do Google foi fechada.')),
    });
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

async function api(path, opts = {}) {
  if (!isConnected()) throw new Error('Conecte o Google Agenda de novo.');
  const r = await fetch(API + encodeURIComponent(calendarId()) + path, {
    ...opts, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (r.status === 204 || r.status === 410) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || ('Erro do Google Agenda (' + r.status + ')'));
  return j;
}

const hhmm = t => (t || '').slice(0, 5);
function addDay(d) { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + 1); return x.toISOString().slice(0, 10); }
function addHour(t) { const [h, m] = hhmm(t).split(':').map(Number); return String(Math.min(h + 1, 23)).padStart(2, '0') + ':' + String(m).padStart(2, '0'); }

function toEvent(r) {
  const ev = {
    summary: r.titulo,
    location: [r.local, r.municipio].filter(Boolean).join(' – ') || undefined,
    description: [r.tipo && 'Tipo: ' + r.tipo, r.contato && 'Contato: ' + r.contato, r.acompanha && 'Acompanha: ' + r.acompanha, r.status && 'Situação: ' + r.status, r.pauta].filter(Boolean).join('\n'),
  };
  if (r.inicio) {
    ev.start = { dateTime: `${r.data}T${hhmm(r.inicio)}:00`, timeZone: TZ };
    ev.end = { dateTime: `${r.data}T${hhmm(r.fim) || addHour(r.inicio)}:00`, timeZone: TZ };
  } else {
    ev.start = { date: r.data }; ev.end = { date: addDay(r.data) };
  }
  return ev;
}

/** Cria, atualiza ou remove o evento no Google. Devolve o id do evento (ou null se removido). */
export async function pushEvent(r) {
  if (r.status === 'Cancelado') {
    if (r.google_event_id) await api('/events/' + encodeURIComponent(r.google_event_id), { method: 'DELETE' });
    return null;
  }
  if (r.google_event_id) {
    try {
      const j = await api('/events/' + encodeURIComponent(r.google_event_id), { method: 'PATCH', body: JSON.stringify(toEvent(r)) });
      if (j) return j.id;
    } catch (e) { if (!/not found|404/i.test(e.message)) throw e; }
  }
  const j = await api('/events', { method: 'POST', body: JSON.stringify(toEvent(r)) });
  return j.id;
}

/** Lê os eventos do Google entre hoje-7 e hoje+120 dias, já no formato da agenda. */
export async function fetchEvents() {
  const min = new Date(); min.setDate(min.getDate() - 7);
  const max = new Date(); max.setDate(max.getDate() + 120);
  const out = []; let page = '';
  do {
    const q = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', maxResults: '250', timeMin: min.toISOString(), timeMax: max.toISOString(), timeZone: TZ });
    if (page) q.set('pageToken', page);
    const j = await api('/events?' + q);
    for (const e of j.items || []) {
      if (e.status === 'cancelled') continue;
      const s = e.start || {}, f = e.end || {};
      const data = s.date || (s.dateTime || '').slice(0, 10);
      if (!data) continue;
      out.push({
        google_event_id: e.id, titulo: e.summary || '(sem título)', data,
        inicio: s.dateTime ? s.dateTime.slice(11, 16) : null,
        fim: f.dateTime ? f.dateTime.slice(11, 16) : null,
        local: e.location || null,
      });
    }
    page = j.nextPageToken || '';
  } while (page);
  return out;
}
