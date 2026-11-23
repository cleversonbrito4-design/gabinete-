// Camada de dados. Com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY definidos usa o
// Supabase (login + banco compartilhado + tempo real). Sem eles, roda em "modo
// demonstração", guardando tudo só neste navegador.
import { createClient } from '@supabase/supabase-js';
import { ORDER } from './schema.js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configured = !!(URL && KEY);
export const sb = configured ? createClient(URL, KEY) : null;

const LS = 'gabinete-demo-v1';
function demoRead() { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } }
function demoWrite(d) { try { localStorage.setItem(LS, JSON.stringify(d)); } catch { /* sem armazenamento */ } }
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

/** Carrega todas as linhas de um módulo (o Supabase entrega no máximo 1000 por vez). */
export async function loadAll(mod) {
  if (!sb) return demoRead()[mod] || [];
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(mod).select('*').order('criado_em', { ascending: false }).range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

/** Cria (id vazio) ou atualiza um registro. Devolve a linha gravada. */
export async function saveRow(mod, id, rec) {
  const body = { ...rec };
  delete body.id; delete body.criado_em; delete body.atualizado_em; delete body.criado_por;
  if (!sb) {
    const d = demoRead(); const a = d[mod] || [];
    const now = new Date().toISOString();
    let row;
    const i = id ? a.findIndex(r => r.id === id) : -1;
    if (i >= 0) { row = { ...a[i], ...body, atualizado_em: now }; a[i] = row; }
    else {
      row = { ...body, id: uuid(), criado_em: now, atualizado_em: now };
      if (mod === 'demandas' && !row.protocolo) { const n = a.reduce((m, r) => Math.max(m, +String(r.protocolo || '').split('-')[1] || 0), 0) + 1; row.protocolo = now.slice(0, 4) + '-' + String(n).padStart(6, '0'); }
      a.unshift(row);
    }
    d[mod] = a; demoWrite(d); return row;
  }
  // se o banco ainda não tiver alguma coluna nova, grava o resto em vez de falhar
  for (let tent = 0; tent < 8; tent++) {
    const q = id ? sb.from(mod).update(body).eq('id', id) : sb.from(mod).insert(body);
    const { data, error } = await q.select().single();
    if (!error) return data;
    const m = /Could not find the '(\w+)' column/.exec(error.message || '');
    if (!m || !(m[1] in body)) throw error;
    console.warn('Coluna ainda não existe no banco:', m[1]); delete body[m[1]];
    if (!Object.keys(body).length) throw error;
  }
  throw new Error('Não foi possível salvar.');
}

export async function deleteRow(mod, id) {
  if (!sb) { const d = demoRead(); d[mod] = (d[mod] || []).filter(r => r.id !== id); demoWrite(d); return; }
  const { error } = await sb.from(mod).delete().eq('id', id);
  if (error) throw error;
}

/** Avisa sobre mudanças feitas por outros usuários. cb(mod, tipo, linhaNova, linhaAntiga) */
export function subscribe(cb) {
  if (!sb) return () => {};
  const ch = sb.channel('gabinete-db');
  for (const m of ORDER) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table: m }, p => cb(m, p.eventType, p.new, p.old));
  }
  ch.subscribe();
  return () => sb.removeChannel(ch);
}

/* ---------- login e perfis ---------- */
export async function getSession() {
  if (!sb) return { user: { id: 'demo', email: 'demonstracao' } };
  const { data } = await sb.auth.getSession();
  return data.session;
}
export function onAuth(cb) { if (sb) sb.auth.onAuthStateChange((ev, session) => cb(ev, session)); }
export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
export async function signOut() { if (sb) await sb.auth.signOut(); }
export async function sendReset(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  if (error) throw error;
}
export async function setPassword(password) {
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw error;
}
export async function loadProfiles() {
  if (!sb) return [{ id: 'demo', nome: 'Usuário de teste' }];
  const { data, error } = await sb.from('perfis').select('*').order('nome');
  if (error) throw error;
  return data;
}
export async function saveProfile(id, nome) {
  if (!sb) return;
  const { error } = await sb.from('perfis').upsert({ id, nome });
  if (error) throw error;
}

/* ---------- configuração do gabinete e modelos de Word ---------- */
const LSC = 'gabinete-demo-config';
export async function getConfig(id) {
  if (!sb) { try { return (JSON.parse(localStorage.getItem(LSC) || '{}'))[id] || null; } catch { return null; } }
  const { data, error } = await sb.from('config').select('valor').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? data.valor : null;
}
export async function setConfig(id, valor) {
  if (!sb) { let all = {}; try { all = JSON.parse(localStorage.getItem(LSC) || '{}'); } catch { /* ok */ } if (valor == null) delete all[id]; else all[id] = valor; try { localStorage.setItem(LSC, JSON.stringify(all)); } catch { throw new Error('Sem espaço no navegador para guardar o modelo.'); } return; }
  if (valor == null) { const { error } = await sb.from('config').delete().eq('id', id); if (error) throw error; return; }
  const { error } = await sb.from('config').upsert({ id, valor, atualizado_em: new Date().toISOString() });
  if (error) throw error;
}

/* ---------- equipe (e-mails liberados) ---------- */
export async function signUp(email, password) {
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) throw error;
  return data;
}
/** true/false; null se não deu para verificar (aí as regras do banco decidem). */
export async function isEquipe() {
  if (!sb) return true;
  const { data, error } = await sb.rpc('is_equipe');
  if (error) return null;
  return !!data;
}
export async function listEquipe() {
  if (!sb) return [];
  let { data, error } = await sb.from('equipe').select('email, admin').order('email');
  if (error && /admin/.test(error.message || '')) ({ data, error } = await sb.from('equipe').select('email').order('email'));
  if (error) throw error;
  return data.map(r => ({ email: r.email, admin: !!r.admin }));
}
/** true se quem está logado é o administrador (pode liberar e remover e-mails). */
export async function isAdmin() {
  if (!sb) return true;
  const { data, error } = await sb.rpc('is_admin');
  if (error) return false;
  return !!data;
}
export async function addEquipe(email) {
  const { error } = await sb.from('equipe').insert({ email: email.trim().toLowerCase() });
  if (error) throw error;
}
export async function removeEquipe(email) {
  const { error } = await sb.from('equipe').delete().eq('email', email);
  if (error) throw error;
}

/* ---------- importação em lote ---------- */
export async function insertMany(mod, rows, onProgress) {
  const out = [];
  if (!sb) {
    const d = demoRead(); const a = d[mod] || []; const now = new Date().toISOString();
    for (const r of rows) { const row = { ...r, id: uuid(), criado_em: now, atualizado_em: now }; a.unshift(row); out.push(row); }
    d[mod] = a; demoWrite(d); return out;
  }
  for (let i = 0; i < rows.length; i += 300) {
    const { data, error } = await sb.from(mod).insert(rows.slice(i, i + 300)).select();
    if (error) throw error;
    out.push(...data);
    if (onProgress) onProgress(Math.min(i + 300, rows.length), rows.length);
  }
  return out;
}

/* ---------- anexos (Supabase Storage, pasta privada "anexos") ---------- */
// No modo demonstração os arquivos ficam só na memória desta aba (somem ao recarregar).
const demoArq = new Map();
export const anexosDisponiveis = true;
export async function enviarAnexo(path, file) {
  if (!sb) { demoArq.set(path, globalThis.URL.createObjectURL(file)); return; }
  const { error } = await sb.storage.from('anexos').upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
  if (error) throw error;
}
export async function linkAnexo(path, nome) {
  if (!sb) { if (!demoArq.has(path)) throw new Error('No modo demonstração o arquivo some ao recarregar a página.'); return demoArq.get(path); }
  const { data, error } = await sb.storage.from('anexos').createSignedUrl(path, 300, nome ? { download: nome } : undefined);
  if (error) throw error;
  return data.signedUrl;
}
export async function apagarAnexo(path) {
  if (!sb) { demoArq.delete(path); return; }
  const { error } = await sb.storage.from('anexos').remove([path]);
  if (error) throw error;
}

/* ---------- formulário público (sem login) ---------- */
export async function novaDemandaPublica(c) {
  if (!sb) throw new Error('O formulário só funciona com o banco ligado.');
  const base = { p_nome: c.nome, p_telefone: c.telefone, p_municipio: c.municipio, p_bairro: c.bairro, p_assunto: c.assunto, p_descricao: c.descricao, ...(c.lat != null ? { p_lat: c.lat, p_lng: c.lng } : {}) };
  let { data, error } = await sb.rpc('nova_demanda_publica', c.fotos && c.fotos.length ? { ...base, p_lat: c.lat ?? null, p_lng: c.lng ?? null, p_fotos: c.fotos } : base);
  const prot = d => typeof d === 'string' ? d : null;
  // banco ainda sem a versão com fotos: manda o pedido sem elas
  if (error && c.fotos && c.fotos.length && /function|p_fotos|PGRST202/i.test(error.message + ' ' + error.code)) { ({ data, error } = await sb.rpc('nova_demanda_publica', base)); if (!error) return { semFotos: true, protocolo: prot(data) }; }
  if (error) throw error;
  return { protocolo: prot(data) };
}
/** Foto mandada pelo cidadão no formulário (só cria, não lê). */
export async function enviarFotoPublica(path, blob) {
  if (!sb) throw new Error('Só funciona com o banco ligado.');
  const { error } = await sb.storage.from('anexos').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
}
/** Vários links temporários de uma vez (para as miniaturas). Devolve { path: url }. */
export async function linksAnexos(paths) {
  if (!paths.length) return {};
  if (!sb) return Object.fromEntries(paths.filter(p => demoArq.has(p)).map(p => [p, demoArq.get(p)]));
  const { data, error } = await sb.storage.from('anexos').createSignedUrls(paths, 3600);
  if (error) throw error;
  return Object.fromEntries(data.filter(d => d.signedUrl).map(d => [d.path, d.signedUrl]));
}

export async function prestacaoPublica() {
  if (!sb) { // modo demonstração: mesma regra da função do banco
    const d = demoRead(); const dt = r => String(r.atualizado_em || r.criado_em || '').slice(0, 10);
    return {
      gabinete: null,
      demandas: (d.demandas || []).filter(r => r.publico && r.status === 'Concluída').map(r => ({ titulo: r.assunto, bairro: r.bairro, municipio: r.municipio, area: r.area, data: dt(r) })),
      servicos: (d.servicos || []).filter(r => r.publico && r.status === 'Atendida').map(r => ({ titulo: r.servico, municipio: r.municipio, orgao: r.orgao, data: dt(r) })),
      emendas: (d.emendas || []).filter(r => r.publico && ['Indicada', 'Empenhada', 'Paga'].includes(r.status)).map(r => ({ titulo: r.objeto, beneficiario: r.beneficiario, municipio: r.municipio, area: r.area, status: r.status, exercicio: r.exercicio, valor: r.valor_pago || r.valor_empenhado || r.valor_indicado })),
    };
  }
  const { data, error } = await sb.rpc('prestacao_publica');
  if (error) throw error;
  return data;
}

/* ---------- pesquisa de satisfação (página aberta, sem login) ---------- */
export async function avaliacaoInfo(token) {
  if (!sb) { const r = (demoRead().demandas || []).find(x => (x.avaliacao_token || x.id) === token); return r ? { assunto: r.assunto, nota: r.nota ?? null, gabinete: null } : null; }
  const { data, error } = await sb.rpc('avaliacao_info', { p_token: token });
  if (error) throw error;
  return data;
}
export async function avaliar(token, nota, comentario) {
  if (!sb) {
    const d = demoRead(); const r = (d.demandas || []).find(x => (x.avaliacao_token || x.id) === token);
    if (!r || r.nota != null) return false;
    const em = new Date().toISOString();
    Object.assign(r, { nota, nota_comentario: comentario || null, nota_em: em, historico: (r.historico || []).concat({ em, txt: 'Avaliação do cidadão: ' + nota + ' de 5', por: 'Cidadão' }) });
    demoWrite(d); return true;
  }
  const { data, error } = await sb.rpc('avaliar_demanda', { p_token: token, p_nota: nota, p_comentario: comentario || '' });
  if (error) throw error;
  return data;
}

/* ---------- administração ---------- */
export async function registrarAcesso(aparelho) {
  if (!sb) return;
  await sb.rpc('registrar_acesso', { p_aparelho: aparelho });
}
/** Conta uma visita a uma página pública (sem dados da pessoa; "novo" = primeira vez no dia neste aparelho). */
export async function registrarVisita(pagina, novo) {
  if (!sb) return;
  await sb.rpc('registrar_visita', { p_pagina: pagina, p_novo: !!novo });
}
export async function listarVisitas(de) {
  if (!sb) return [];
  let q = sb.from('visitas').select('dia, pagina, visitas, visitantes').order('dia').limit(5000);
  if (de) q = q.gte('dia', de);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}
export async function adminUsuarios() {
  if (!sb) { const agora = new Date().toISOString(); return [{ email: 'demonstracao', nome: 'Demonstração', admin: true, conta_criada: agora, ultimo_login: agora, ultimo_acesso: agora, acessos_30d: 1 }]; }
  const { data, error } = await sb.rpc('admin_usuarios');
  if (error) throw error;
  return data || [];
}
export async function listarAcessos(email, limite = 200) {
  if (!sb) return [{ email: 'demonstracao', em: new Date().toISOString(), aparelho: 'Computador' }];
  let q = sb.from('acessos').select('email, em, aparelho').order('em', { ascending: false }).limit(limite);
  if (email) q = q.eq('email', email);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

/** Consulta pública do andamento: precisa do protocolo e do celular juntos. */
export async function consultarProtocolo(protocolo, telefone) {
  if (!sb) {
    const d = (demoRead().demandas || []).find(r => r.protocolo === protocolo.trim().toUpperCase() && String(r.telefone || '').replace(/\D/g, '').slice(-8) === String(telefone).replace(/\D/g, '').slice(-8));
    if (!d) return null;
    return { protocolo: d.protocolo, assunto: d.assunto, status: d.status, bairro: d.bairro, municipio: d.municipio, aberto_em: d.criado_em, atualizado_em: d.atualizado_em,
      linha: (d.historico || []).filter(h => /^(Situação:|Cadastrado como|Recebida pelo formulário|Ofício de solicitação criado)/.test(h.txt || '')).map(h => ({ em: h.em, txt: /^Situação:/.test(h.txt) ? 'Situação: ' + h.txt.split('→')[1].trim() : /^Ofício/.test(h.txt) ? (h.txt.includes(' para ') ? 'Gabinete preparou ofício para ' + h.txt.split(' para ').slice(1).join(' para ') : 'Gabinete preparou ofício ao órgão responsável') : 'Pedido registrado no gabinete' }))
        .concat((demoRead().servicos || []).filter(o => o.demanda_id === d.id).flatMap(o => (o.historico || []).filter(h => /^(Situação:|Resposta do órgão)/.test(h.txt || '')).map(h => {
          const org = o.orgao || 'O órgão responsável';
          if (/^Resposta do órgão/.test(h.txt)) return { em: h.em, txt: org + ' respondeu ao ofício' };
          const st = h.txt.split('→')[1].trim();
          return { em: h.em, txt: st === 'Ofício enviado' ? 'Ofício' + (o.protocolo ? ' nº ' + o.protocolo : '') + ' enviado para ' + (o.orgao || 'o órgão responsável') : st === 'Em execução' ? org + ' está executando o serviço' : st === 'Atendida' ? org + ' atendeu o pedido' : st === 'Não atendida' ? org + ' não atendeu o pedido' : '' };
        }))).filter(x => x.txt).sort((a, b) => String(a.em).localeCompare(String(b.em))) };
  }
  const { data, error } = await sb.rpc('consultar_protocolo', { p_protocolo: protocolo, p_telefone: telefone });
  if (error) throw error;
  return data;
}

/* ---------- agenda: link para Gmail/Outlook/iPhone e outras agendas ---------- */
export async function agendaFn(acao, extra = {}) {
  if (!sb) throw new Error('Ligue o banco de dados para usar esta função.');
  const { data, error } = await sb.functions.invoke('agenda', { body: { acao, ...extra } });
  if (error) {
    let msg = '';
    try { const j = await error.context.json(); msg = j.erro; } catch { /* ok */ }
    if (!msg && /Failed to send|fetch/i.test(error.message || '')) msg = 'Sem conexão com o servidor da agenda. Tente de novo.';
    throw new Error(msg || error.message || 'Erro na agenda.');
  }
  if (data?.erro) throw new Error(data.erro);
  return data;
}

/* ---------- avisos no celular antes dos compromissos ---------- */
export async function avisosFn(acao, extra = {}) {
  if (!sb) throw new Error('Ligue o banco de dados para usar esta função.');
  const { data, error } = await sb.functions.invoke('avisos', { body: { acao, ...extra } });
  if (error) {
    let msg = '';
    try { const j = await error.context.json(); msg = j.erro; } catch { /* ok */ }
    if (!msg && /Failed to send|fetch/i.test(error.message || '')) msg = 'Sem conexão com o servidor. Tente de novo.';
    throw new Error(msg || error.message || 'Erro nos avisos.');
  }
  if (data?.erro) throw new Error(data.erro);
  return data;
}
