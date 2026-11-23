// Função "agenda" do gabinete (Supabase Edge Function, publicada com verify_jwt = false).
//
// 1) GET ?t=<código>  → a agenda do sistema em formato iCal (.ics). É o link que se
//    coloca no Google Agenda, Outlook ou iPhone para os compromissos aparecerem lá
//    sozinhos. O código fica em config "agenda_link" e só a equipe vê.
// 2) POST (com login da equipe) { acao }:
//    - "link"      → devolve o link acima (cria o código na primeira vez)
//    - "novo-link" → troca o código (o link antigo para de funcionar). Só o administrador.
//    - "salvar"    → grava a lista de outras agendas (Gmail, Outlook, iPhone…) { agendas }
//    - "eventos"   → lê as outras agendas pelo endereço iCal delas e devolve os
//                    compromissos já prontos para mostrar no sistema.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const TZ = 'America/Sao_Paulo';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const pad = (n: number) => String(n).padStart(2, '0');
const novoCodigo = () => crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8);

async function getConfig(id: string) {
  const { data } = await admin.from('config').select('valor').eq('id', id).maybeSingle();
  return data?.valor ?? null;
}
async function setConfig(id: string, valor: unknown) {
  const { error } = await admin.from('config').upsert({ id, valor, atualizado_em: new Date().toISOString() });
  if (error) throw error;
}

async function quemE(req: Request) {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const { data } = await admin.auth.getUser(jwt);
  const email = data?.user?.email?.toLowerCase();
  if (!email) return null;
  const { data: e } = await admin.from('equipe').select('email, admin').eq('email', email).maybeSingle();
  return e ? { email, admin: !!e.admin } : null;
}

async function linkAtual(req: Request, trocar = false) {
  let v = await getConfig('agenda_link');
  if (!v?.token || trocar) { v = { token: novoCodigo(), criado_em: new Date().toISOString() }; await setConfig('agenda_link', v); }
  const base = new URL(req.url);
  const host = req.headers.get('x-forwarded-host') || base.host;
  return `https://${host}/functions/v1/agenda?t=${v.token}`;
}

/* ---------------- 1) agenda do sistema em .ics ---------------- */
function esc(s: string) { return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
function fold(line: string) {
  const enc = new TextEncoder(); const out: string[] = []; let cur = '', n = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (n + b > 73) { out.push(cur); cur = ' '; n = 1; }
    cur += ch; n += b;
  }
  out.push(cur); return out.join('\r\n');
}
const hhmm = (t: string | null) => (t || '').slice(0, 5);
function addDays(d: string, k: number) { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); }
// Horário de Brasília (sem horário de verão desde 2019): UTC−3
function utcStamp(data: string, hora: string) {
  const [h, m] = hora.split(':').map(Number);
  const x = new Date(Date.UTC(+data.slice(0, 4), +data.slice(5, 7) - 1, +data.slice(8, 10), h + 3, m));
  return x.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
}

async function feed(token: string) {
  const v = await getConfig('agenda_link');
  if (!v?.token || token.length < 20 || token !== v.token) return new Response('Link inválido ou trocado.', { status: 404, headers: CORS });
  const desde = addDays(new Date().toISOString().slice(0, 10), -120);
  const { data: rows, error } = await admin.from('agenda').select('*').gte('data', desde).neq('status', 'Cancelado').order('data').limit(3000);
  if (error) return new Response('Erro ao ler a agenda.', { status: 500, headers: CORS });
  const agora = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Fala Cascavel//Agenda do gabinete//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Agenda do gabinete (Fala Cascavel)', 'X-WR-TIMEZONE:' + TZ, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  for (const r of rows || []) {
    if (!r.data) continue;
    const titulo = (r.status === 'A confirmar' ? 'A confirmar: ' : '') + (r.titulo || 'Compromisso');
    const desc = [r.tipo && 'Tipo: ' + r.tipo, r.contato && 'Contato: ' + r.contato, r.acompanha && 'Acompanha: ' + r.acompanha, r.status && 'Situação: ' + r.status, r.pauta].filter(Boolean).join('\n');
    L.push('BEGIN:VEVENT', 'UID:' + r.id + '@falacascavel', 'DTSTAMP:' + agora);
    if (r.inicio) {
      const fim = hhmm(r.fim) && hhmm(r.fim) > hhmm(r.inicio) ? hhmm(r.fim) : (() => { const [h, m] = hhmm(r.inicio).split(':').map(Number); return pad(Math.min(h + 1, 23)) + ':' + pad(h + 1 > 23 ? 59 : m); })();
      L.push('DTSTART:' + utcStamp(r.data, hhmm(r.inicio)), 'DTEND:' + utcStamp(r.data, fim));
    } else {
      L.push('DTSTART;VALUE=DATE:' + r.data.replace(/-/g, ''), 'DTEND;VALUE=DATE:' + addDays(r.data, 1).replace(/-/g, ''));
    }
    L.push('SUMMARY:' + esc(titulo));
    const loc = [r.local, r.municipio].filter(Boolean).join(' – ');
    if (loc) L.push('LOCATION:' + esc(loc));
    if (desc) L.push('DESCRIPTION:' + esc(desc));
    L.push('STATUS:' + (r.status === 'A confirmar' ? 'TENTATIVE' : 'CONFIRMED'), 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return new Response(L.map(fold).join('\r\n') + '\r\n', {
    headers: { ...CORS, 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="agenda-gabinete.ics"', 'Cache-Control': 'max-age=300' },
  });
}

/* ---------------- 2) ler outras agendas (.ics) ---------------- */
type Prop = { v: string; p: Record<string, string> };
type Ev = Record<string, Prop[]>;

function parseIcs(txt: string) {
  const lines = txt.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const evs: Ev[] = []; let cur: Ev | null = null; let depth = 0;
  for (const ln of lines) {
    if (ln === 'BEGIN:VEVENT') { cur = {}; depth = 0; continue; }
    if (!cur) continue;
    if (ln.startsWith('BEGIN:')) { depth++; continue; }
    if (ln.startsWith('END:')) { if (ln === 'END:VEVENT' && depth === 0) { evs.push(cur); cur = null; } else depth--; continue; }
    if (depth) continue;
    const i = ln.indexOf(':'); if (i < 0) continue;
    const [nome, ...ps] = ln.slice(0, i).split(';');
    const p: Record<string, string> = {};
    for (const x of ps) { const j = x.indexOf('='); if (j > 0) p[x.slice(0, j).toUpperCase()] = x.slice(j + 1).replace(/^"|"$/g, ''); }
    (cur[nome.toUpperCase()] ||= []).push({ v: ln.slice(i + 1), p });
  }
  return evs;
}
const un = (s?: string) => (s || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();

// diferença (minutos) entre o fuso tz e UTC num instante
function offsetMin(tz: string, utcMs: number) {
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const o: Record<string, string> = {}; for (const x of f.formatToParts(new Date(utcMs))) o[x.type] = x.value;
    return (Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute) - Math.floor(utcMs / 60000) * 60000) / 60000;
  } catch { return null; }
}
// devolve o instante (ms UTC) de um DTSTART/DTEND; null se for dia inteiro
function instante(pr: Prop): { ms: number | null; dia: string } {
  const v = pr.v.trim();
  const d = v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6, 8);
  if (pr.p.VALUE === 'DATE' || v.length === 8) return { ms: null, dia: d };
  const h = +v.slice(9, 11), m = +v.slice(11, 13), s = +v.slice(13, 15) || 0;
  const wall = Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8), h, m, s);
  if (v.endsWith('Z')) return { ms: wall, dia: d };
  const tz = pr.p.TZID || TZ;
  let off = offsetMin(tz, wall); if (off == null) off = offsetMin(TZ, wall)!;
  let ms = wall - off * 60000; const off2 = offsetMin(tz, ms); if (off2 != null && off2 !== off) ms = wall - off2 * 60000;
  return { ms, dia: d };
}
// instante → data e hora de Brasília
function local(ms: number) { const x = new Date(ms - 3 * 3600000); return { data: x.toISOString().slice(0, 10), hora: x.toISOString().slice(11, 16) }; }

const DIAS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
function expandir(ev: Ev, de: string, ate: string, max = 400) {
  const ds = ev.DTSTART?.[0]; if (!ds) return [];
  const ini = instante(ds);
  const de_ = ev.DTEND?.[0] ? instante(ev.DTEND[0]) : null;
  const durMs = ini.ms != null ? (de_?.ms != null ? de_.ms - ini.ms : 3600000) : 0;
  const durDias = ini.ms == null ? Math.max(1, de_ ? Math.round((Date.parse(de_.dia) - Date.parse(ini.dia)) / 86400000) : 1) : 0;
  const base = ini.ms != null ? local(ini.ms) : { data: ini.dia, hora: '' };
  const rr = ev.RRULE?.[0]?.v;
  const exc = new Set<string>();
  for (const x of ev.EXDATE || []) for (const v of x.v.split(',')) { const i = instante({ v, p: x.p }); exc.add(i.ms != null ? local(i.ms).data : i.dia); }
  const datas: string[] = [];
  if (!rr) datas.push(base.data);
  else {
    const R: Record<string, string> = {}; for (const kv of rr.split(';')) { const [k, v] = kv.split('='); R[k.toUpperCase()] = v; }
    const freq = R.FREQ, intv = Math.max(1, +R.INTERVAL || 1), count = +R.COUNT || 0;
    let until = '9999-12-31';
    if (R.UNTIL) { const u = instante({ v: R.UNTIL, p: {} }); until = u.ms != null ? local(u.ms).data : u.dia; }
    const fimJanela = until < ate ? until : ate;
    const byday = (R.BYDAY || '').split(',').filter(Boolean);
    const d0 = new Date(base.data + 'T12:00:00Z');
    let n = 0;
    const aceita = (d: string) => { if (d < base.data) return true; n++; if (count && n > count) return false; if (d >= de && d <= fimJanela && !exc.has(d)) datas.push(d); return true; };
    if (freq === 'DAILY') {
      for (let k = 0; k <= 20000; k += intv) { const x = new Date(d0); x.setUTCDate(x.getUTCDate() + k); const d = x.toISOString().slice(0, 10); if (d > fimJanela || !aceita(d) || datas.length >= max) break; }
    } else if (freq === 'WEEKLY') {
      const dias = byday.length ? byday.map(b => DIAS.indexOf(b.slice(-2))).filter(i => i >= 0).sort() : [d0.getUTCDay()];
      const semana0 = new Date(d0); semana0.setUTCDate(d0.getUTCDate() - d0.getUTCDay());
      outer: for (let w = 0; w <= 3000; w += intv) {
        for (const di of dias) { const x = new Date(semana0); x.setUTCDate(semana0.getUTCDate() + w * 7 + di); const d = x.toISOString().slice(0, 10); if (d > fimJanela || datas.length >= max) break outer; if (!aceita(d)) break outer; }
      }
    } else if (freq === 'MONTHLY' || freq === 'YEARLY') {
      const passoM = freq === 'MONTHLY' ? intv : 12 * intv;
      const nth = byday.length === 1 ? byday[0].match(/^([+-]?\d+)?([A-Z]{2})$/) : null;
      for (let k = 0; k <= 1200; k += passoM) {
        const y = d0.getUTCFullYear(), mo = d0.getUTCMonth() + k;
        let x: Date;
        if (nth && nth[1]) {
          const alvo = DIAS.indexOf(nth[2]), ord = +nth[1];
          if (ord > 0) { x = new Date(Date.UTC(y, mo, 1, 12)); x.setUTCDate(1 + ((alvo - x.getUTCDay() + 7) % 7) + (ord - 1) * 7); }
          else { x = new Date(Date.UTC(y, mo + 1, 0, 12)); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() - alvo + 7) % 7) + (ord + 1) * 7); }
          if (x.getUTCMonth() !== ((mo % 12) + 12) % 12) continue;
        } else {
          x = new Date(Date.UTC(y, mo, d0.getUTCDate(), 12));
          if (x.getUTCDate() !== d0.getUTCDate()) continue; // dia 31 em mês curto
        }
        const d = x.toISOString().slice(0, 10);
        if (d > fimJanela || datas.length >= max || !aceita(d)) break;
      }
    } else datas.push(base.data);
  }
  return datas.map(d => {
    if (ini.ms == null) return { data: d, inicio: null, fim: null, dias: durDias };
    const fimMs = Date.parse(d + 'T' + base.hora + ':00Z') + 3 * 3600000 + durMs;
    const f = local(fimMs);
    return { data: d, inicio: base.hora, fim: f.data === d ? f.hora : null, dias: 1 };
  });
}

function hostPermitido(u: URL) {
  if (u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^[\d.]+$/.test(h) || h.includes(':')) return false;
  return true;
}

let diag: Record<string, unknown> = {};
async function lerAgenda(url: string, de: string, ate: string) {
  diag = {};
  const u = new URL(url.trim().replace(/^webcals?:\/\//i, 'https://'));
  if (!hostPermitido(u)) throw new Error('Endereço não aceito. Use o link que começa com https:// ou webcal://');
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  let r: Response;
  try { r = await fetch(u, { signal: ctl.signal, headers: { 'User-Agent': 'FalaCascavel-Agenda/1.0', Accept: 'text/calendar, */*' } }); }
  catch { throw new Error('A agenda não respondeu. Confira o link.'); } finally { clearTimeout(t); }
  diag = { http: r.status };
  if (!r.ok) throw new Error(r.status === 404 || r.status === 403 ? 'Link não encontrado ou sem permissão. Copie de novo o endereço secreto.' : 'A agenda respondeu com erro ' + r.status + '.');
  const txt = await r.text();
  if (txt.length > 15_000_000) throw new Error('Agenda grande demais.');
  if (!/BEGIN:VCALENDAR/i.test(txt)) throw new Error('Esse link não é de agenda (iCal). Use o "endereço secreto no formato iCal".');
  const evs = parseIcs(txt);
  diag = { http: r.status, bytes: txt.length, vevents: evs.length };
  const nomeCal = un((txt.match(/^X-WR-CALNAME:(.*)$/m) || [])[1]);
  // instâncias alteradas de eventos que se repetem (RECURRENCE-ID)
  const alterado = new Set<string>();
  for (const e of evs) if (e['RECURRENCE-ID']) { const i = instante(e['RECURRENCE-ID'][0]); alterado.add(e.UID?.[0]?.v + '|' + (i.ms != null ? local(i.ms).data : i.dia)); }
  const out: Record<string, unknown>[] = [];
  for (const e of evs) {
    if ((e.STATUS?.[0]?.v || '').toUpperCase() === 'CANCELLED') continue;
    const uid = e.UID?.[0]?.v || crypto.randomUUID();
    const titulo = un(e.SUMMARY?.[0]?.v) || '(sem título)';
    const localTxt = un(e.LOCATION?.[0]?.v) || null;
    const ehMestre = !e['RECURRENCE-ID'] && e.RRULE;
    for (const o of expandir(e, de, ate)) {
      if (ehMestre && alterado.has(uid + '|' + o.data)) continue;
      for (let k = 0; k < Math.min(o.dias, 14); k++) {
        const d = k ? addDays(o.data, k) : o.data;
        if (d < de || d > ate) continue;
        out.push({ uid: uid + '|' + d, titulo, data: d, inicio: o.inicio, fim: o.fim, local: localTxt });
      }
    }
    if (out.length > 3000) break;
  }
  return { nomeCal, eventos: out };
}

/* ---------------- servidor ---------------- */
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);
  try {
    if (req.method === 'GET') {
      const t = url.searchParams.get('t');
      if (t) return await feed(t.replace(/\.ics$/i, ''));
      return new Response('Agenda do gabinete.', { headers: CORS });
    }
    const quem = await quemE(req);
    if (!quem) return json({ erro: 'Entre no sistema com um e-mail da equipe.' }, 401);
    const body = await req.json().catch(() => ({}));
    const acao = body.acao;
    if (acao === 'link') return json({ url: await linkAtual(req) });
    if (acao === 'novo-link') {
      if (!quem.admin) return json({ erro: 'Só o administrador pode trocar o link.' }, 403);
      return json({ url: await linkAtual(req, true) });
    }
    if (acao === 'salvar') {
      const lista = (Array.isArray(body.agendas) ? body.agendas : []).slice(0, 15).map((a: Record<string, unknown>) => ({
        id: String(a.id || crypto.randomUUID()).slice(0, 60), nome: String(a.nome || 'Agenda').slice(0, 60),
        url: String(a.url || '').trim().slice(0, 1000), cor: /^#[0-9a-f]{6}$/i.test(String(a.cor)) ? a.cor : '#8b5cf6',
      })).filter((a: { url: string }) => /^(https|webcals?):\/\//i.test(a.url));
      for (const a of lista) { const u = new URL(a.url.replace(/^webcals?:\/\//i, 'https://')); if (!hostPermitido(u)) return json({ erro: 'Endereço não aceito: ' + a.nome }, 400); }
      await setConfig('agendas_externas', { lista, por: quem.email, em: new Date().toISOString() });
      return json({ ok: true, agendas: lista });
    }
    if (acao === 'testar') {
      const hoje = new Date().toISOString().slice(0, 10);
      const r = await lerAgenda(String(body.url || ''), addDays(hoje, -31), addDays(hoje, 200));
      return json({ ok: true, nome: r.nomeCal, total: r.eventos.length });
    }
    if (acao === 'eventos') {
      const hoje = new Date().toISOString().slice(0, 10);
      const de = /^\d{4}-\d{2}-\d{2}$/.test(body.de) ? body.de : addDays(hoje, -62);
      const ate = /^\d{4}-\d{2}-\d{2}$/.test(body.ate) ? body.ate : addDays(hoje, 200);
      const cfg = await getConfig('agendas_externas');
      const lista = cfg?.lista || [];
      const res = [];
      const estado: Record<string, unknown>[] = [];
      for (const a of lista as { id: string; nome: string; url: string; cor: string }[]) {
        try { const r = await lerAgenda(a.url, de, ate); res.push({ id: a.id, nome: a.nome, cor: a.cor, eventos: r.eventos }); estado.push({ id: a.id, ok: true, eventos: r.eventos.length, ...diag }); }
        catch (e) { res.push({ id: a.id, nome: a.nome, cor: a.cor, eventos: [], erro: (e as Error).message }); estado.push({ id: a.id, ok: false, erro: (e as Error).message, ...diag }); }
      }
      // situação da última leitura (sem títulos nem links), para conferir sem abrir a tela
      await setConfig('agendas_externas_status', { em: new Date().toISOString(), de, ate, agendas: estado }).catch(() => {});
      return json({ agendas: res });
    }
    return json({ erro: 'Ação desconhecida.' }, 400);
  } catch (e) {
    return json({ erro: (e as Error).message || 'Erro.' }, 500);
  }
});
