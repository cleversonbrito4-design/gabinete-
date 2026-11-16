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
    else { row = { ...body, id: uuid(), criado_em: now, atualizado_em: now }; a.unshift(row); }
    d[mod] = a; demoWrite(d); return row;
  }
  const q = id ? sb.from(mod).update(body).eq('id', id) : sb.from(mod).insert(body);
  const { data, error } = await q.select().single();
  if (error) throw error;
  return data;
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
