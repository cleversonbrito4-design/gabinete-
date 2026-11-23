// Função "avisos" do gabinete (Supabase Edge Function, publicada com verify_jwt = false).
// Faz o celular/computador tocar um aviso ~30 minutos antes de cada compromisso da
// agenda, mesmo com o sistema fechado (notificação push).
//
// POST { acao } com login da equipe:
//   - "chave"     → chave pública para o aparelho se inscrever
//   - "inscrever" → guarda o aparelho { sub, aparelho }
//   - "cancelar"  → apaga o aparelho { endpoint }
//   - "testar"    → manda um aviso de teste para o aparelho { endpoint }
// POST { acao: "rodar" } com o cabeçalho x-avisos (o relógio do banco, pg_cron, a
// cada 5 minutos) → manda os avisos dos compromissos que começam nos próximos 35 min.
//
// Tabelas (sem acesso pelo site, só por esta função): segredos, avisos_aparelhos,
// avisos_enviados — ver supabase/avisos.sql.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import { enviarPush, novasChavesVapid, type Aparelho } from './webpush.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const CONTATO = 'https://falacascavel.com.br';
const ANTES_MIN = 35; // avisa quando faltar até 35 min (o relógio roda a cada 5)
const BRT = '-03:00'; // Brasília (sem horário de verão)

async function quemE(req: Request) {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (jwt.split('.').length !== 3) return null;
  const comoUsuario = createClient(Deno.env.get('SUPABASE_URL')!, (Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!, {
    auth: { persistSession: false }, global: { headers: { Authorization: 'Bearer ' + jwt } },
  });
  const eq = await comoUsuario.rpc('is_equipe');
  if (eq.error || eq.data !== true) return null;
  let email = '';
  try { email = String(JSON.parse(atob(((p: string) => p + '='.repeat((4 - p.length % 4) % 4))(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))).email || '').toLowerCase(); } catch { /* ok */ }
  return { email };
}

// chaves do envio: criadas na primeira vez e guardadas na tabela segredos
async function chaves(): Promise<{ publica: string; privada: string; cron: string }> {
  const { data } = await admin.from('segredos').select('valor').eq('id', 'avisos').maybeSingle();
  if (data?.valor?.publica) return data.valor;
  const v = { ...(await novasChavesVapid()), cron: crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '') };
  await admin.from('segredos').upsert({ id: 'avisos', valor: v }, { onConflict: 'id', ignoreDuplicates: true });
  const { data: d2 } = await admin.from('segredos').select('valor').eq('id', 'avisos').single();
  return d2!.valor;
}

const hhmm = (t: string | null) => (t || '').slice(0, 5);
const addDia = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

async function mandarParaTodos(dados: Record<string, unknown>, so?: string) {
  const v = await chaves();
  let q = admin.from('avisos_aparelhos').select('endpoint,p256dh,auth');
  if (so) q = q.eq('endpoint', so);
  const { data: aps } = await q;
  let ok = 0; const erros: string[] = [];
  for (const ap of (aps || []) as Aparelho[]) {
    try {
      const r = await enviarPush(ap, dados, v, CONTATO);
      if (r.ok) { ok++; await admin.from('avisos_aparelhos').update({ ultimo_envio: new Date().toISOString(), falhas: 0 }).eq('endpoint', ap.endpoint); }
      else if (r.status === 404 || r.status === 410) await admin.from('avisos_aparelhos').delete().eq('endpoint', ap.endpoint); // aparelho desligou os avisos
      else erros.push(r.status + ' ' + (await r.text()).slice(0, 120));
    } catch (e) { erros.push((e as Error).message); }
  }
  return { aparelhos: (aps || []).length, ok, erros };
}

async function rodar() {
  const agora = Date.now();
  const hoje = new Date(agora - 3 * 3600e3).toISOString().slice(0, 10);
  const { data: rows, error } = await admin.from('agenda').select('id,titulo,data,inicio,fim,local,status')
    .in('data', [hoje, addDia(hoje, 1)]).neq('status', 'Cancelado').not('inicio', 'is', null);
  if (error) throw error;
  const devidos = (rows || []).map(r => ({ ...r, ms: Date.parse(`${r.data}T${hhmm(r.inicio)}:00${BRT}`) - agora }))
    .filter(r => r.ms <= ANTES_MIN * 60e3 && r.ms > -5 * 60e3);
  const res: unknown[] = [];
  for (const r of devidos) {
    // marca antes de mandar: se o relógio rodar duas vezes, só uma manda
    const chave = `${r.id}|${r.data}|${hhmm(r.inicio)}`;
    const { data: marcou } = await admin.from('avisos_enviados').upsert({ chave }, { onConflict: 'chave', ignoreDuplicates: true }).select('chave');
    if (!marcou?.length) continue;
    const min = Math.max(0, Math.round(r.ms / 60e3));
    const quando = min <= 1 ? 'Agora' : `Em ${min} min`;
    res.push(await mandarParaTodos({
      title: `⏰ ${quando}: ${r.titulo || 'Compromisso'}`,
      body: [hhmm(r.inicio) + (r.fim ? '–' + hhmm(r.fim) : ''), r.local].filter(Boolean).join(' · '),
      tag: 'agenda-' + r.id, url: '/#agenda',
    }));
  }
  await admin.from('avisos_enviados').delete().lt('em', new Date(agora - 3 * 864e5).toISOString());
  return { devidos: devidos.length, envios: res };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return new Response('Avisos do gabinete.', { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const acao = body.acao;
    if (acao === 'rodar') {
      const v = await chaves();
      if (req.headers.get('x-avisos') !== v.cron) return json({ erro: 'Sem permissão.' }, 401);
      return json(await rodar());
    }
    const quem = await quemE(req);
    if (!quem) return json({ erro: 'Entre no sistema com um e-mail da equipe.' }, 401);
    if (acao === 'chave') return json({ publica: (await chaves()).publica });
    if (acao === 'inscrever') {
      const s = body.sub || {};
      const ap = { endpoint: String(s.endpoint || ''), p256dh: String(s.keys?.p256dh || ''), auth: String(s.keys?.auth || '') };
      if (!/^https:\/\//.test(ap.endpoint) || !ap.p256dh || !ap.auth) return json({ erro: 'Aparelho inválido.' }, 400);
      const { error } = await admin.from('avisos_aparelhos').upsert({ ...ap, email: quem.email, aparelho: String(body.aparelho || '').slice(0, 120), falhas: 0 });
      if (error) throw error;
      return json({ ok: true });
    }
    if (acao === 'cancelar') {
      await admin.from('avisos_aparelhos').delete().eq('endpoint', String(body.endpoint || ''));
      return json({ ok: true });
    }
    if (acao === 'testar') {
      const r = await mandarParaTodos({ title: '🔔 Avisos ligados', body: 'É assim que o aviso vai tocar 30 minutos antes de cada compromisso.', tag: 'teste', url: '/#agenda' }, String(body.endpoint || '-'));
      if (!r.aparelhos) return json({ erro: 'Este aparelho não está inscrito. Ligue os avisos de novo.' }, 400);
      if (!r.ok) return json({ erro: 'O aviso não saiu: ' + (r.erros[0] || 'erro') }, 502);
      return json({ ok: true });
    }
    return json({ erro: 'Ação desconhecida.' }, 400);
  } catch (e) {
    return json({ erro: (e as Error).message || 'Erro.' }, 500);
  }
});
