import './style.css';
import { MODS, ORDER } from './schema.js';
import * as store from './store.js';
import * as gcal from './google.js';
import { MODELOS, folhas } from './etiquetas.js';
import * as docs from './documentos.js';

/* Dados do gabinete: editáveis em "Minha conta"; os do .env são só o ponto de partida. */
const env = import.meta.env;
const CFG_CAMPOS = [
  ['gabinete', 'Nome do gabinete', env.VITE_NOME_GABINETE || 'Gestão do Gabinete'],
  ['deputado_nome', 'Nome do deputado (como assina)', env.VITE_DEPUTADO_NOME || ''],
  ['deputado_cargo', 'Cargo', env.VITE_DEPUTADO_CARGO || 'Deputado Estadual'],
  ['casa_legislativa', 'Casa legislativa', env.VITE_CASA || 'Assembleia Legislativa do Estado'],
  ['cidade_gabinete', 'Cidade do gabinete (para a data dos documentos)', env.VITE_CIDADE || ''],
  ['endereco_gabinete', 'Endereço, telefone e e-mail do gabinete (rodapé)', env.VITE_ENDERECO_GABINETE || ''],
  ['ultimo_oficio', 'Último nº de ofício já emitido fora do sistema (ex.: 163)', env.VITE_ULTIMO_OFICIO || ''],
];
const cfg = Object.fromEntries(CFG_CAMPOS.map(([k, , v]) => [k, v]));
const NOME_GAB = () => cfg.gabinete || 'Gestão do Gabinete';
const TITULO = () => (String(cfg.deputado_cargo || 'Deputado').split('/')[0].trim().toLowerCase() || 'deputado');
const DEP = () => cfg.deputado_nome ? TITULO() + ' ' + cfg.deputado_nome : TITULO();

/* ---------- utilidades ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const todayStr = () => ymd(new Date());
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
const hhmm = t => (t || '').slice(0, 5);
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
function fmtDate(s) { if (!s) return ''; const [y, m, d] = s.split('-'); return d + '/' + m + (y !== String(new Date().getFullYear()) ? '/' + y.slice(2) : ''); }
function fmtDay(s) { const d = new Date(s + 'T12:00:00'); return WD[d.getDay()] + ', ' + d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' }); }
function fmtStamp(iso) { try { const d = new Date(iso); return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); } catch { return ''; } }
const brl = v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(+v || 0);
function parseMoney(s) { if (s == null || s === '') return null; const n = parseFloat(String(s).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')); return isNaN(n) ? null : n; }
const kindOf = (mod, st) => { const f = MODS[mod].statuses.find(x => x[0] === st); return f ? f[1] : 'novo'; };
const STATUS_KIND = { novo: 'k-novo', and: 'k-and', ok: 'k-ok', neg: 'k-neg' };
const isOpen = (mod, r) => mod === 'pessoas' ? r.status !== 'Inativo' : mod === 'agenda' ? (r.data >= todayStr() && r.status !== 'Cancelado') : ['novo', 'and'].includes(kindOf(mod, r.status));
const isLate = (mod, r) => { const f = MODS[mod].deadline; return f && r[f] && isOpen(mod, r) && r[f] < todayStr(); };
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }
const errMsg = e => (e && (e.message || e.error_description)) || 'Erro desconhecido';

/** Link do WhatsApp (wa.me). Números sem DDI recebem +55. */
function waLink(phone, text) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length <= 11) d = '55' + d.replace(/^0+/, '');
  return 'https://wa.me/' + d + (text ? '?text=' + encodeURIComponent(text) : '');
}
const primeiroNome = n => String(n || '').trim().split(/\s+/)[0] || '';
function waTexto(mod, r) {
  if (mod === 'pessoas') return `Olá, ${primeiroNome(r.nome)}! Aqui é do gabinete do ${DEP()}.`;
  if (mod === 'demandas') return `Olá, ${primeiroNome(r.solicitante)}! Aqui é do gabinete do ${DEP()}. Sobre a sua solicitação "${r.assunto}": a situação atual é "${r.status}".`;
  if (mod === 'servicos') return `Olá, ${primeiroNome(r.solicitante)}! Aqui é do gabinete do ${DEP()}. Sobre o pedido "${r.servico}"${r.orgao ? ' enviado para ' + r.orgao : ''}: a situação atual é "${r.status}".`;
  return '';
}
const waAniversario = p => `Olá, ${primeiroNome(p.nome)}! O ${DEP()} e toda a equipe do gabinete desejam a você um feliz aniversário, com muita saúde e alegria!`;

/* ---------- estado ---------- */
const data = Object.fromEntries(ORDER.map(m => [m, []]));
const state = { view: 'painel', q: '', filter: 'abertos', agendaWin: 'proximos', loaded: false, session: null, profiles: [], et: { tipo: '', grupo: '', municipio: '', mes: '', modelo: '6180', pular: 0 } };
const drawer = { open: false, mod: null, id: null };
const VIEWS = ['painel', 'etiquetas', 'conta', ...ORDER];

function readHash() { const h = location.hash.slice(1); if (VIEWS.includes(h)) state.view = h; }
window.addEventListener('hashchange', () => { readHash(); state.q = ''; state.filter = 'abertos'; render(); });
function go(v) { if (location.hash !== '#' + v) location.hash = v; else { state.view = v; render(); } window.scrollTo(0, 0); }

/* ---------- login ---------- */
const authHash = window.__authHash || '';
let mustSetPassword = /type=(invite|recovery)/.test(authHash);

let loginMode = 'entrar';
function renderLogin(msg = '', ok = '', email = '') {
  const criar = loginMode === 'criar';
  document.body.innerHTML = `<div class="login"><form class="login-card" id="login" novalidate>
    <div style="display:flex;gap:10px;align-items:center"><div class="mark">G</div><h1>${esc(NOME_GAB())}</h1></div>
    ${criar ? '<div class="m">Use o e-mail que a equipe liberou para você.</div>' : ''}
    <div class="f"><label for="l-email">E-mail</label><input id="l-email" type="email" autocomplete="username" value="${esc(email)}" required></div>
    <div class="f"><label for="l-pass">${criar ? 'Crie uma senha (mínimo 8 caracteres)' : 'Senha'}</label><input id="l-pass" type="password" autocomplete="${criar ? 'new-password' : 'current-password'}" required></div>
    ${msg ? `<div class="err">${esc(msg)}</div>` : ''}${ok ? `<div class="ok-msg">${esc(ok)}</div>` : ''}
    <button class="btn primary" type="submit" style="justify-content:center">${criar ? 'Criar minha conta' : 'Entrar'}</button>
    ${criar ? '<button class="linkbtn" type="button" id="l-mode">Já tenho conta: entrar</button>' : '<button class="linkbtn" type="button" id="l-forgot">Esqueci minha senha</button><button class="linkbtn" type="button" id="l-mode">Primeiro acesso? Criar minha conta</button>'}
  </form></div>`;
  $('#l-mode').addEventListener('click', () => { loginMode = criar ? 'entrar' : 'criar'; renderLogin('', '', $('#l-email').value.trim()); });
  $('#login').addEventListener('submit', async e => {
    e.preventDefault();
    const em = $('#l-email').value.trim(), pw = $('#l-pass').value;
    const b = e.target.querySelector('[type=submit]'); b.disabled = true; b.textContent = criar ? 'Criando…' : 'Entrando…';
    if (criar) {
      if (pw.length < 8) return renderLogin('A senha precisa ter pelo menos 8 caracteres.', '', em);
      try { const d = await store.signUp(em, pw); if (!d.session) { loginMode = 'entrar'; renderLogin('', 'Conta criada! Abra o e-mail que enviamos para ' + em + ', clique no link de confirmação e depois entre aqui com a sua senha.', em); } }
      catch (err) { renderLogin(/registered|already/i.test(errMsg(err)) ? 'Esse e-mail já tem conta. Use "Já tenho conta: entrar".' : errMsg(err), '', em); }
      return;
    }
    try { await store.signIn(em, pw); }
    catch (err) { renderLogin(/invalid/i.test(errMsg(err)) ? 'E-mail ou senha incorretos.' : /confirm/i.test(errMsg(err)) ? 'Confirme seu e-mail primeiro: abra a mensagem que enviamos e clique no link.' : errMsg(err), '', em); }
  });
  if ($('#l-forgot')) $('#l-forgot').addEventListener('click', async () => {
    const email = $('#l-email').value.trim();
    if (!email) return renderLogin('Digite seu e-mail acima e clique de novo em "Esqueci minha senha".');
    try { await store.sendReset(email); renderLogin('', 'Enviamos um link para ' + email + '. Abra o e-mail para criar uma nova senha.'); }
    catch (err) { renderLogin(errMsg(err)); }
  });
}

function renderSetPassword(msg = '') {
  document.body.innerHTML = `<div class="login"><form class="login-card" id="setpw" novalidate>
    <h1>Crie sua senha</h1><div class="m">Você vai usar esta senha para entrar no sistema do gabinete.</div>
    <div class="f"><label for="p1">Nova senha (mínimo 8 caracteres)</label><input id="p1" type="password" autocomplete="new-password"></div>
    <div class="f"><label for="p2">Repita a senha</label><input id="p2" type="password" autocomplete="new-password"></div>
    ${msg ? `<div class="err">${esc(msg)}</div>` : ''}
    <button class="btn primary" type="submit" style="justify-content:center">Salvar senha</button></form></div>`;
  $('#setpw').addEventListener('submit', async e => {
    e.preventDefault();
    const a = $('#p1').value, b = $('#p2').value;
    if (a.length < 8) return renderSetPassword('A senha precisa ter pelo menos 8 caracteres.');
    if (a !== b) return renderSetPassword('As duas senhas não são iguais.');
    try { await store.setPassword(a); mustSetPassword = false; history.replaceState(null, '', location.pathname + '#painel'); startApp(); }
    catch (err) { renderSetPassword(errMsg(err)); }
  });
}

function renderSemAcesso() {
  const em = state.session?.user?.email || '';
  document.body.innerHTML = `<div class="login"><div class="login-card">
    <h1>Acesso ainda não liberado</h1>
    <p class="m">O e-mail <b>${esc(em)}</b> entrou, mas ainda não está na lista da equipe do gabinete.</p>
    <p class="m">Peça para alguém da equipe abrir <b>☰ → Minha conta → Equipe</b> e incluir este e-mail. Depois toque em "Tentar de novo".</p>
    <button class="btn primary" id="sa-retry" style="justify-content:center">Tentar de novo</button>
    <button class="linkbtn" id="sa-sair">Sair</button></div></div>`;
  $('#sa-retry').addEventListener('click', () => startApp());
  $('#sa-sair').addEventListener('click', () => store.signOut());
}

function renderAskName(msg = '') {
  document.body.innerHTML = `<div class="login"><form class="login-card" id="askname" novalidate>
    <h1>Como você se chama?</h1><div class="m">Seu nome aparece para a equipe como responsável pelos registros.</div>
    <div class="f"><label for="nm">Nome</label><input id="nm" autocomplete="name"></div>
    ${msg ? `<div class="err">${esc(msg)}</div>` : ''}
    <button class="btn primary" type="submit" style="justify-content:center">Continuar</button></form></div>`;
  $('#askname').addEventListener('submit', async e => {
    e.preventDefault();
    const n = $('#nm').value.trim(); if (!n) return renderAskName('Digite seu nome.');
    try { await store.saveProfile(state.session.user.id, n); startApp(); } catch (err) { renderAskName(errMsg(err)); }
  });
}

/* ---------- estrutura da página ---------- */
function shell() {
  document.body.innerHTML = `
<header class="top"><div class="wrap">
  <div class="brand">
    <div class="brand-l"><div class="mark">G</div><h1>${esc(NOME_GAB())}<small>Demandas, ofícios, emendas, proposituras, agenda e pessoas</small></h1></div>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="btn" id="btn-export" hidden>Exportar</button>
      <button class="btn primary" id="btn-new">+ Novo</button>
      <button class="btn ghost" data-go="conta" title="Minha conta" aria-label="Minha conta">☰</button>
    </div>
  </div>
  <nav class="tabs" id="tabs" role="tablist"></nav>
</div></header>
<main class="wrap" id="main"></main>
<div id="overlay"></div><style id="page-css"></style>`;
}

const myName = () => (state.profiles.find(p => p.id === state.session?.user?.id) || {}).nome || '';

function renderTabs() {
  const tabs = [['painel', 'Painel', null]].concat(ORDER.map(m => [m, MODS[m].label, data[m].filter(r => isOpen(m, r)).length]));
  const cur = state.view === 'etiquetas' ? 'pessoas' : state.view;
  $('#tabs').innerHTML = tabs.map(([k, l, n]) => `<button class="tab" role="tab" data-go="${k}" aria-selected="${cur === k}">${l}${n != null ? `<span class="n">${n}</span>` : ''}</button>`).join('');
  const nb = $('#btn-new');
  nb.hidden = state.view === 'conta' || state.view === 'etiquetas';
  nb.textContent = '+ ' + (state.view === 'painel' ? MODS.demandas.novo : MODS[state.view]?.novo || 'Novo');
  $('#btn-export').hidden = !MODS[state.view];
}

function banner() {
  if (!store.configured) return `<div class="banner">Modo demonstração: o banco de dados ainda não foi ligado, então os registros ficam salvos só neste navegador.</div>`;
  if (!state.loaded) return `<div class="banner">Carregando dados do gabinete…</div>`;
  return '';
}

/* ---------- painel ---------- */
function renderPainel() {
  const t = todayStr(), w = addDays(t, 7);
  const kpi = (m, big, sub, extra = '') => `<button class="kpi" data-go="${m}"><span class="eyebrow">${MODS[m].label}</span><span class="big">${big}</span><span class="sub">${sub}</span>${extra}</button>`;
  const late = m => data[m].filter(r => isLate(m, r)).length;
  const lateTxt = m => late(m) ? `<span class="alert">${late(m)} com prazo vencido</span>` : '';
  const hoje = data.agenda.filter(r => r.data === t && r.status !== 'Cancelado').length;
  const sem = data.agenda.filter(r => r.data >= t && r.data <= w && r.status !== 'Cancelado').length;
  const kpis = [
    kpi('demandas', data.demandas.filter(r => isOpen('demandas', r)).length, 'demandas em aberto', lateTxt('demandas')),
    kpi('servicos', data.servicos.filter(r => isOpen('servicos', r)).length, 'ofícios aguardando resposta', lateTxt('servicos')),
    kpi('emendas', data.emendas.filter(r => isOpen('emendas', r)).length, 'pedidos em aberto', `<span class="sub">${brl(data.emendas.filter(r => isOpen('emendas', r)).reduce((s, r) => s + (+r.valor_pedido || 0), 0))} pedidos</span>`),
    kpi('agenda', hoje, `compromisso${hoje === 1 ? '' : 's'} hoje`, `<span class="sub">${sem} nos próximos 7 dias</span>`),
  ].join('');

  const prox = data.agenda.filter(r => r.data >= t && r.data <= w && r.status !== 'Cancelado').sort((a, b) => (a.data + hhmm(a.inicio)).localeCompare(b.data + hhmm(b.inicio))).slice(0, 8);
  const agHtml = prox.length ? prox.map(r => `<div class="ag-item" data-open="agenda:${r.id}"><div class="ag-when"><b>${r.data === t ? 'Hoje' : fmtDate(r.data)}</b>${esc(hhmm(r.inicio))}</div><div style="min-width:0"><div class="t">${esc(r.titulo)}</div><div class="m">${esc(MODS.agenda.meta(r))}</div></div><span class="pill ${STATUS_KIND[kindOf('agenda', r.status)]}">${esc(r.status)}</span></div>`).join('')
    : `<div class="empty"><b>Nada marcado para os próximos 7 dias</b>Use “Novo compromisso” na aba Agenda.</div>`;

  const md = s => s.slice(5); const days = [...Array(8)].map((_, i) => md(addDays(t, i)));
  const aniv = data.pessoas.filter(r => r.nascimento && r.status !== 'Inativo' && days.includes(md(r.nascimento))).sort((a, b) => days.indexOf(md(a.nascimento)) - days.indexOf(md(b.nascimento)));
  const anivHtml = aniv.length ? aniv.slice(0, 10).map(r => { const wa = waLink(r.telefone, waAniversario(r)); return `<div class="ag-item" data-open="pessoas:${r.id}"><div class="ag-when"><b>${md(r.nascimento) === md(t) ? 'Hoje' : r.nascimento.slice(8, 10) + '/' + r.nascimento.slice(5, 7)}</b></div><div style="min-width:0"><div class="t">${esc(r.nome)}</div><div class="m">${esc([r.tipo, r.municipio].filter(Boolean).join(' · '))}</div></div>${wa ? `<a class="btn wa mini" href="${esc(wa)}" target="_blank" rel="noopener" data-stop>Parabenizar</a>` : ''}</div>`; }).join('')
    : `<div class="empty"><b>Nenhum aniversário nos próximos 7 dias</b>Cadastre a data de aniversário na aba Pessoas.</div>`;

  const pend = []; ['demandas', 'servicos'].forEach(m => data[m].forEach(r => { if (isOpen(m, r) && r.prazo && r.prazo <= w) pend.push([m, r]); }));
  pend.sort((a, b) => a[1].prazo.localeCompare(b[1].prazo));
  const pendHtml = pend.length ? pend.slice(0, 8).map(([m, r]) => `<div class="ag-item" data-open="${m}:${r.id}"><div class="ag-when"><b>${fmtDate(r.prazo)}</b>${m === 'demandas' ? 'demanda' : 'ofício'}</div><div style="min-width:0"><div class="t">${esc(MODS[m].title(r))}</div><div class="m">${esc(MODS[m].meta(r))}</div></div><span class="pill ${r.prazo < t ? 'k-late' : 'k-and'}">${r.prazo < t ? 'Vencido' : 'Esta semana'}</span></div>`).join('')
    : `<div class="empty"><b>Nenhum prazo vencido ou nesta semana</b>Prazos aparecem aqui quando faltam 7 dias ou menos.</div>`;

  const col = { novo: 'var(--novo)', and: 'var(--and)', ok: 'var(--ok)', neg: 'var(--neg)' };
  const bars = (rows, maxV, fmt) => `<div class="bars">${rows.map(x => `<div class="bar-row"><span>${esc(x.s)} <span class="m">(${x.n})</span></span><div class="bar"><i style="width:${(x.v / (maxV || 1) * 100).toFixed(1)}%;background:${x.c}"></i></div><span class="num">${fmt(x.v)}</span></div>`).join('')}</div>`;
  const val = r => +(r.valor_indicado || r.valor_pedido) || 0;
  const em = MODS.emendas.statuses.map(([s, k]) => { const rs = data.emendas.filter(r => r.status === s); return { s, c: col[k], n: rs.length, v: rs.reduce((a, r) => a + val(r), 0) }; });
  const ano = String(new Date().getFullYear());
  const emHtml = bars(em, Math.max(...em.map(x => x.v)), brl) + `<div class="total"><span>Pago com exercício ${ano}</span><span class="num" style="font-size:13px">${brl(data.emendas.filter(r => r.status === 'Paga' && String(r.exercicio || '') === ano).reduce((a, r) => a + val(r), 0))}</span></div>`;

  const porMun = {}; data.demandas.filter(r => isOpen('demandas', r)).forEach(r => { const k = r.municipio || 'Sem município'; porMun[k] = (porMun[k] || 0) + 1; });
  const mun = Object.entries(porMun).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, n]) => ({ s, n, v: n, c: 'var(--accent)' }));
  const munHtml = mun.length ? bars(mun, Math.max(...mun.map(x => x.v)), v => v) : `<div class="empty"><b>Sem demandas em aberto</b></div>`;

  return `${banner()}<div class="eyebrow">${fmtDay(t)}</div><h2 class="sec">Olá${myName() ? ', ' + esc(primeiroNome(myName())) : ''}</h2>
    <div class="kpis">${kpis}</div>
    <div class="cols">
      <div style="display:flex;flex-direction:column;gap:18px;min-width:0">
        <section class="panel"><h3>Próximos 7 dias na agenda <a data-go="agenda">ver agenda</a></h3>${agHtml}</section>
        <section class="panel"><h3>Aniversariantes da semana <a data-go="pessoas">ver pessoas</a></h3>${anivHtml}</section>
      </div>
      <div style="display:flex;flex-direction:column;gap:18px;min-width:0">
        <section class="panel"><h3>Prazos a cobrar</h3>${pendHtml}</section>
        <section class="panel"><h3>Emendas por situação <a data-go="emendas">ver emendas</a></h3>${emHtml}</section>
        <section class="panel"><h3>Demandas abertas por município</h3>${munHtml}</section>
      </div>
    </div>`;
}

/* ---------- listas ---------- */
function filtered(m) {
  const q = state.q.trim().toLowerCase();
  let a = data[m].slice();
  const t = todayStr();
  if (m === 'agenda') {
    if (state.agendaWin === 'proximos') a = a.filter(r => r.data >= t); else if (state.agendaWin === 'passados') a = a.filter(r => r.data < t);
    a.sort((x, y) => (x.data + hhmm(x.inicio)).localeCompare(y.data + hhmm(y.inicio)));
    if (state.agendaWin === 'passados') a.reverse();
  } else if (m === 'pessoas') {
    if (state.filter === 'abertos') a = a.filter(r => r.status !== 'Inativo');
    else if (state.filter.startsWith('tipo:')) a = a.filter(r => r.tipo === state.filter.slice(5));
    else if (state.filter === 'aniv') { const mm = t.slice(5, 7); a = a.filter(r => r.nascimento && r.nascimento.slice(5, 7) === mm).sort((x, y) => x.nascimento.slice(8).localeCompare(y.nascimento.slice(8))); }
    if (state.filter !== 'aniv') a.sort((x, y) => String(x.nome || '').localeCompare(String(y.nome || ''), 'pt-BR'));
  } else {
    if (state.filter === 'abertos') a = a.filter(r => isOpen(m, r));
    else if (state.filter === 'atrasados') a = a.filter(r => isLate(m, r));
    else if (state.filter === 'meus') a = a.filter(r => r.responsavel && r.responsavel === myName());
    else if (state.filter !== 'todos') a = a.filter(r => r.status === state.filter);
    const px = { Alta: 0, 'Média': 1, Baixa: 2 };
    a.sort((x, y) => { const lx = isLate(m, x) ? 0 : 1, ly = isLate(m, y) ? 0 : 1; if (lx !== ly) return lx - ly; const d = (px[x.prioridade] ?? 1) - (px[y.prioridade] ?? 1); if (d) return d; return String(y.criado_em || '').localeCompare(String(x.criado_em || '')); });
  }
  if (q) a = a.filter(r => Object.values(r).some(v => (typeof v === 'string' || typeof v === 'number') && String(v).toLowerCase().includes(q)));
  return a;
}

function midText(m, r) {
  if (m === 'demandas') return r.prazo ? 'Prazo ' + fmtDate(r.prazo) : (r.responsavel || '');
  if (m === 'servicos') return r.prazo ? 'Resposta até ' + fmtDate(r.prazo) : (r.data_envio ? 'Enviado ' + fmtDate(r.data_envio) : '');
  if (m === 'emendas') { const v = r.valor_indicado || r.valor_pedido; return v ? brl(v) : ''; }
  if (m === 'proposituras') return r.data_protocolo ? 'Protocolo ' + fmtDate(r.data_protocolo) : '';
  if (m === 'pessoas') return r.nascimento ? 'Aniv. ' + r.nascimento.slice(8, 10) + '/' + r.nascimento.slice(5, 7) : (r.grupo || '');
  return '';
}

function rowHtml(m, r) {
  if (m === 'pessoas') return `<button class="row" data-open="pessoas:${r.id}"><div style="min-width:0"><div class="t">${esc(r.nome)}</div><div class="m">${esc(MODS.pessoas.meta(r))}</div></div><div class="mid m">${esc(midText(m, r))}</div><div class="right">${r.status === 'Inativo' ? '<span class="pill k-neg">Inativo</span>' : r.tipo === 'Liderança' ? '<span class="pill k-novo">Liderança</span>' : ''}</div></button>`;
  const late = isLate(m, r);
  const pr = r.prioridade ? `<span class="prio ${r.prioridade === 'Alta' ? 'alta' : r.prioridade === 'Média' ? 'media' : 'baixa'}">${esc(r.prioridade)}</span> ` : '';
  return `<button class="row" data-open="${m}:${r.id}"><div style="min-width:0"><div class="t">${esc(MODS[m].title(r))}</div><div class="m">${pr}${esc(MODS[m].meta(r))}</div></div><div class="mid m ${m === 'emendas' ? 'num' : ''}">${esc(midText(m, r))}</div><div class="right"><span class="pill ${late ? 'k-late' : STATUS_KIND[kindOf(m, r.status)]}">${late ? 'Atrasado' : esc(r.status)}</span></div></button>`;
}

function chip(attr, k, l, on) { return `<button class="chip" ${attr}="${esc(k)}" aria-pressed="${on}">${esc(l)}</button>`; }

function renderList(m) {
  const M = MODS[m]; const a = filtered(m);
  let chips, extra = '';
  if (m === 'agenda') {
    chips = [['proximos', 'Próximos'], ['passados', 'Passados'], ['todos', 'Todos']].map(([k, l]) => chip('data-win', k, l, state.agendaWin === k)).join('');
    if (gcal.googleAvailable) extra = `<div class="no-print" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px"><button class="btn mini" id="g-sync">${gcal.isConnected() ? 'Sincronizar com Google Agenda' : 'Conectar Google Agenda'}</button><span class="gstat" id="g-stat">${gcal.isConnected() ? 'Conectado · calendário: ' + esc(gcal.calendarId()) : 'Compromissos salvos aqui vão para o Google Agenda do parlamentar.'}</span></div>`;
  } else if (m === 'pessoas') {
    chips = [['abertos', 'Ativos'], ['tipo:Liderança', 'Lideranças'], ['tipo:Entidade / associação', 'Entidades'], ['aniv', 'Aniversariantes do mês'], ['todos', 'Todos']].map(([k, l]) => chip('data-filter', k, l, state.filter === k)).join('');
    extra = `<div class="no-print" style="margin-bottom:4px"><button class="btn mini" data-go="etiquetas">Imprimir etiquetas</button></div>`;
  } else {
    const opts = [['abertos', 'Em aberto']].concat(M.deadline ? [['atrasados', 'Atrasados']] : []).concat(M.fields.some(f => f.k === 'responsavel') ? [['meus', 'Comigo']] : []).concat([['todos', 'Todos']], M.statuses.map(s => [s[0], s[0]]));
    chips = opts.map(([k, l]) => chip('data-filter', k, l, state.filter === k)).join('');
  }
  let body;
  if (!data[m].length) body = `<div class="empty"><b>Nenhum registro ainda</b>Clique em “+ ${esc(M.novo)}” para cadastrar o primeiro.</div>`;
  else if (!a.length) body = `<div class="empty"><b>Nada encontrado</b>Mude o filtro ou a busca.</div>`;
  else if (m === 'agenda') {
    const t = todayStr(); let out = '', cur = '';
    a.forEach(r => {
      if (r.data !== cur) { cur = r.data; const n = a.filter(x => x.data === cur).length; out += `<div class="day-h ${cur === t ? 'today' : ''}"><span>${cur === t ? 'Hoje · ' : ''}${fmtDay(cur)}</span><span class="m">${n} compromisso${n > 1 ? 's' : ''}</span></div>`; }
      out += `<button class="row" data-open="agenda:${r.id}"><div style="min-width:0"><div class="t"><span class="num" style="margin-right:8px;color:var(--muted)">${esc(hhmm(r.inicio) || 'Dia todo')}${r.fim ? '–' + esc(hhmm(r.fim)) : ''}</span>${esc(r.titulo)}</div><div class="m">${esc(M.meta(r))}${r.google_event_id ? ' · no Google' : ''}</div></div><div class="mid m">${esc(r.contato || '')}</div><div class="right"><span class="pill ${STATUS_KIND[kindOf('agenda', r.status)]}">${esc(r.status)}</span></div></button>`;
    });
    body = out;
  } else body = a.map(r => rowHtml(m, r)).join('');
  return `${banner()}<h2 class="sec">${M.label}</h2><div class="m" style="margin-top:2px">${M.hint}</div>
    <div class="print-only m">Impresso em ${fmtStamp(new Date().toISOString())} · ${a.length} registro(s)</div>
    <div class="toolbar"><input class="search" id="q" type="search" placeholder="Buscar por nome, município, assunto, protocolo…" value="${esc(state.q)}"><div class="chips">${chips}</div></div>
    ${extra}<div class="list" id="list">${body}</div>`;
}

/* ---------- etiquetas ---------- */
function etiquetasFiltradas() {
  const f = state.et;
  return data.pessoas.filter(p => p.status !== 'Inativo' && p.endereco &&
    (!f.tipo || p.tipo === f.tipo) && (!f.grupo || p.grupo === f.grupo) && (!f.municipio || p.municipio === f.municipio) &&
    (!f.mes || (p.nascimento && p.nascimento.slice(5, 7) === f.mes)))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
}
function renderEtiquetas() {
  const f = state.et;
  const uniq = k => [...new Set(data.pessoas.map(p => p[k]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
  const sel = (id, label, opts, v) => `<div class="f"><label for="${id}">${label}</label><select id="${id}" data-et="${id.slice(3)}"><option value="">Todos</option>${opts.map(o => `<option value="${esc(o[0] ?? o)}" ${String(o[0] ?? o) === String(v) ? 'selected' : ''}>${esc(o[1] ?? o)}</option>`).join('')}</select></div>`;
  const list = etiquetasFiltradas();
  const semEnd = data.pessoas.filter(p => p.status !== 'Inativo' && !p.endereco).length;
  const { html, css } = folhas(list, f.modelo, +f.pular || 0, true);
  $('#page-css').textContent = css;
  return `<div class="no-print"><a class="linkbtn" data-go="pessoas">← Pessoas</a></div>
    <h2 class="sec" style="margin-top:6px">Etiquetas de correspondência</h2>
    <div class="m">${list.length} etiqueta(s)${semEnd ? ` · ${semEnd} pessoa(s) sem endereço ficaram de fora` : ''}. No navegador, imprima em tamanho real (100%, sem margens).</div>
    <div class="filters">
      ${sel('et-tipo', 'Tipo', MODS.pessoas.fields.find(x => x.k === 'tipo').opts, f.tipo)}
      ${sel('et-grupo', 'Grupo', uniq('grupo'), f.grupo)}
      ${sel('et-municipio', 'Município', uniq('municipio'), f.municipio)}
      ${sel('et-mes', 'Aniversário no mês', MESES.map((n, i) => [pad(i + 1), n]), f.mes)}
      <div class="f"><label for="et-modelo">Modelo da etiqueta</label><select id="et-modelo" data-et="modelo">${Object.entries(MODELOS).map(([k, v]) => `<option value="${k}" ${k === f.modelo ? 'selected' : ''}>${esc(v.nome)}</option>`).join('')}</select></div>
      <div class="f"><label for="et-pular">Pular posições já usadas</label><input id="et-pular" data-et="pular" type="number" min="0" max="80" value="${esc(f.pular)}"></div>
    </div>
    <div class="no-print" style="margin-bottom:12px"><button class="btn primary" id="et-print" ${list.length ? '' : 'disabled'}>Imprimir etiquetas</button></div>
    <div class="sheet-wrap">${html}</div>`;
}

/* ---------- conta ---------- */
function renderConta() {
  const u = state.session?.user || {};
  return `<h2 class="sec">Minha conta</h2>
  <div class="cols" style="margin-top:14px">
    <section class="panel"><h3>Seus dados</h3>
      <form id="perfil" class="filters" style="grid-template-columns:1fr;margin:0" novalidate>
        <div class="f"><label>E-mail</label><input value="${esc(u.email || '')}" disabled></div>
        <div class="f"><label for="pf-nome">Nome</label><input id="pf-nome" value="${esc(myName())}"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" type="submit">Salvar nome</button>${store.configured ? '<button class="btn" type="button" id="pf-senha">Trocar senha</button><button class="btn danger" type="button" id="pf-sair">Sair</button>' : ''}</div>
      </form></section>
    <section class="panel"><h3>Equipe</h3>
      <p class="m" style="margin-top:0">Só os e-mails desta lista conseguem ver os dados. Para incluir alguém, adicione o e-mail aqui e peça para a pessoa abrir o sistema e tocar em <b>"Primeiro acesso? Criar minha conta"</b>.</p>
      <div id="equipe-box"><div class="m">Carregando…</div></div>
      ${store.configured ? `<form id="eq-add" style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap" novalidate><input id="eq-email" type="email" placeholder="email@exemplo.com" style="flex:1 1 200px;min-width:0;border:1px solid var(--line);background:var(--bg);border-radius:7px;padding:8px 10px"><button class="btn primary" type="submit">Liberar e-mail</button></form>` : ''}
      ${state.profiles.length ? `<div class="eyebrow" style="margin-top:14px">Nomes cadastrados</div><div class="m">${state.profiles.map(p => esc(p.nome)).join(', ')}</div>` : ''}</section>
    <section class="panel"><h3>Dados do gabinete</h3><p class="m" style="margin-top:0">Aparecem no topo do sistema e nos ofícios e indicações.</p>
      <form id="cfg" class="filters" style="grid-template-columns:1fr;margin:0" novalidate>${CFG_CAMPOS.map(([k, l]) => `<div class="f"><label for="cfg-${k}">${esc(l)}</label><input id="cfg-${k}" value="${esc(cfg[k])}"></div>`).join('')}
      <div><button class="btn primary" type="submit">Salvar dados do gabinete</button></div></form></section>
    <section class="panel"><h3>Modelos de Word</h3><p class="m" style="margin-top:0">Baixe o modelo, mude o que quiser no Word (brasão, fonte, textos) e envie de volta. Os campos entre chaves são preenchidos pelo sistema.</p>
      <div id="modelos-box"><div class="m">Carregando…</div></div>
      <details style="margin-top:10px"><summary class="m" style="cursor:pointer">Campos que você pode usar no modelo</summary><div class="hist"><ol>${docs.CAMPOS.map(([k, l]) => `<li><time>{${k}}</time><span>${esc(l)}</span></li>`).join('')}</ol></div></details></section>
    ${gcal.googleAvailable ? `<section class="panel"><h3>Google Agenda</h3>
      <div class="f"><label for="g-cal">ID do calendário do parlamentar</label><input id="g-cal" value="${esc(gcal.calendarId())}"></div>
      <p class="m">Use "primary" para o seu calendário principal, ou o ID que aparece em Configurações do calendário → Integrar agenda (termina em @group.calendar.google.com ou é o e-mail do parlamentar).</p>
      <button class="btn" id="g-cal-save">Salvar calendário</button></section>` : ''}
  </div>`;
}

/* ---------- render principal ---------- */
function render() {
  if (!$('#main')) return;
  renderTabs();
  const main = $('#main');
  const hadFocus = document.activeElement && document.activeElement.id === 'q'; const pos = hadFocus ? document.activeElement.selectionStart : 0;
  if (state.view !== 'etiquetas') $('#page-css').textContent = '';
  if (state.view === 'conta') setTimeout(async () => {
    const b = $('#modelos-box'); if (b) b.innerHTML = await modelosHtml();
    const q = $('#equipe-box'); if (q) { try { const l = await store.listEquipe(); const me = (state.session?.user?.email || '').toLowerCase(); q.innerHTML = l.length ? l.map(e => `<div class="ag-item" style="cursor:default;grid-template-columns:minmax(0,1fr) auto;align-items:center"><div class="t" style="font-weight:500">${esc(e)}${e === me ? ' <span class="m">(você)</span>' : ''}</div>${e === me ? '' : `<button class="btn mini ghost" data-eq-del="${esc(e)}">Remover</button>`}</div>`).join('') : '<div class="m">Nenhum e-mail na lista.</div>'; } catch (err) { q.innerHTML = '<div class="m">' + (store.configured ? esc(errMsg(err)) : 'Disponível quando o banco estiver ligado.') + '</div>'; } }
  }, 0);
  main.innerHTML = state.view === 'painel' ? renderPainel() : state.view === 'etiquetas' ? renderEtiquetas() : state.view === 'conta' ? renderConta() : renderList(state.view);
  if (hadFocus) { const q = $('#q'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch { /* ok */ } } }
  if (drawer.open) refreshDatalists();
}

/* ---------- gaveta de edição ---------- */
function allMunis() { const s = new Set(); ORDER.forEach(m => data[m].forEach(r => r.municipio && s.add(r.municipio))); return [...s].sort(); }
function refreshDatalists() {
  const set = (id, items) => { const el = document.getElementById(id); if (el) el.innerHTML = items.join(''); };
  set('dl-munis', allMunis().map(x => `<option value="${esc(x)}">`));
  set('dl-pessoas', data.pessoas.map(p => `<option value="${esc(p.nome)}">${esc([p.tipo, p.municipio].filter(Boolean).join(' · '))}</option>`));
  set('dl-equipe', state.profiles.map(p => `<option value="${esc(p.nome)}">`));
}

function fieldInput(f, v, ro) {
  const id = 'f-' + f.k; const dis = ro ? 'disabled' : '';
  if (f.type === 'select') { const opts = f.opts.includes(v) || !v ? f.opts : [v, ...f.opts]; return `<select id="${id}" ${dis}><option value=""></option>${opts.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`; }
  if (f.type === 'textarea') return `<textarea id="${id}" ${dis}>${esc(v)}</textarea>`;
  if (f.type === 'money') return `<input id="${id}" inputmode="decimal" placeholder="0,00" value="${v !== '' && v != null ? esc(Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })) : ''}" ${dis}>`;
  const type = ['date', 'time', 'number', 'tel', 'email', 'url'].includes(f.type) ? f.type : 'text';
  const list = f.list ? 'list="dl-munis"' : f.people ? 'list="dl-pessoas"' : f.team ? 'list="dl-equipe"' : '';
  return `<input id="${id}" type="${type}" value="${esc(f.type === 'time' ? hhmm(v) : v)}" ${list} ${f.mono ? 'style="font-family:var(--mono)"' : ''} autocomplete="off" ${dis}>`;
}

function openDrawer(mod, id, preset = {}) {
  const M = MODS[mod]; const rec = id ? data[mod].find(r => r.id === id) : null;
  if (id && !rec) return;
  drawer.open = true; drawer.mod = mod; drawer.id = id;
  const defaults = { status: M.statuses[0][0], ...(mod === 'agenda' ? { data: todayStr() } : {}), ...(mod === 'emendas' ? { exercicio: new Date().getFullYear() } : {}), ...(mod === 'proposituras' ? { ano: new Date().getFullYear() } : {}), ...(M.fields.some(f => f.k === 'responsavel') ? { responsavel: myName() } : {}) };
  const r = rec || { ...defaults, ...preset };
  const fields = M.fields.map(f => `<div class="f ${f.wide ? 'wide' : ''}"><label for="f-${f.k}">${esc(f.l)}${f.req ? ' <span class="req">*</span>' : ''}</label>${fieldInput(f, r[f.k] ?? '', false)}</div>`).join('');
  const statusSel = `<div class="f"><label for="f-status">Situação</label><select id="f-status">${M.statuses.map(s => `<option ${s[0] === r.status ? 'selected' : ''}>${esc(s[0])}</option>`).join('')}</select></div>`;
  const hist = rec && rec.historico && rec.historico.length ? `<div class="hist"><span class="eyebrow">Histórico</span><ol>${rec.historico.slice().reverse().map(h => `<li><time>${fmtStamp(h.em)}</time><span>${esc(h.txt)}${h.por ? ' <span class="m">· ' + esc(h.por) + '</span>' : ''}</span></li>`).join('')}</ol></div>` : '';
  // ações rápidas
  const acts = [];
  if (rec && M.phone) { const wa = waLink(rec[M.phone], waTexto(mod, rec)); if (wa) acts.push(`<a class="btn wa mini" href="${esc(wa)}" target="_blank" rel="noopener">Abrir WhatsApp</a>`); }
  if (rec && mod === 'pessoas') {
    const linked = ['demandas', 'servicos', 'emendas'].reduce((n, m) => n + data[m].filter(x => [x.solicitante, x.beneficiario, x.quem_pediu].includes(rec.nome)).length, 0);
    acts.push(`<button class="btn mini" type="button" data-new-for="demandas">+ Demanda desta pessoa</button>`);
    if (linked) acts.push(`<button class="btn mini" type="button" data-search="${esc(rec.nome)}">Ver ${linked} registro(s) ligado(s)</button>`);
  }
  const dt = rec && docTipo(mod, rec);
  if (dt) acts.push(`<button class="btn mini" type="button" id="btn-doc">Gerar ${docs.TIPOS[dt]} (Word)</button>`);
  if (rec && mod === 'proposituras' && rec.link) acts.push(`<a class="btn mini" href="${esc(rec.link)}" target="_blank" rel="noopener">Abrir tramitação</a>`);
  $('#overlay').innerHTML = `<div class="scrim" data-close></div><aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="dr-t">
    <div class="dr-head"><div style="min-width:0"><div class="eyebrow">${esc(M.label)}</div><h3 id="dr-t">${rec ? esc(M.title(rec)) : esc(M.novo)}</h3></div><button class="btn ghost" data-close aria-label="Fechar">✕</button></div>
    <form class="dr-body" id="frm" novalidate>${acts.length ? `<div class="dr-actions">${acts.join('')}</div>` : ''}${statusSel}<div class="f"></div>${fields}
      <datalist id="dl-munis"></datalist><datalist id="dl-pessoas"></datalist><datalist id="dl-equipe"></datalist><div class="err" id="frm-err" hidden></div>${hist}
      ${rec ? `<div class="m" style="grid-column:1/-1">Cadastrado em ${fmtStamp(rec.criado_em)} · atualizado em ${fmtStamp(rec.atualizado_em)}</div>` : ''}</form>
    <div class="dr-foot"><div id="del-zone">${rec ? '<button class="btn danger" id="btn-del" type="button">Excluir</button>' : ''}</div><div class="r"><button class="btn" data-close type="button">Cancelar</button><button class="btn primary" id="btn-save" type="button">Salvar</button></div></div></aside>`;
  refreshDatalists();
  // ao escolher uma pessoa cadastrada, preenche telefone e município
  ['solicitante'].forEach(k => { const el = $('#f-' + k); if (el) el.addEventListener('change', () => { const p = data.pessoas.find(x => x.nome === el.value); if (!p) return; [['telefone', 'telefone'], ['municipio', 'municipio'], ['bairro', 'bairro']].forEach(([a, b]) => { const t = $('#f-' + a); if (t && !t.value && p[b]) t.value = p[b]; }); }); });
  setTimeout(() => { const f = $('#f-' + M.fields[0].k); f && f.focus(); }, 30);
}
function closeDrawer() { drawer.open = false; $('#overlay').innerHTML = ''; }

function readForm(mod) {
  const rec = {};
  for (const f of MODS[mod].fields) {
    let v = $('#f-' + f.k).value.trim();
    if (f.type === 'money') v = parseMoney(v); else if (f.type === 'number') v = v ? parseInt(v, 10) : null; else if (v === '') v = null;
    rec[f.k] = v;
  }
  return rec;
}
async function saveDrawer() {
  const { mod, id } = drawer; const M = MODS[mod]; const old = id ? data[mod].find(r => r.id === id) : null;
  const rec = readForm(mod);
  const missing = M.fields.filter(f => f.req && (rec[f.k] == null || rec[f.k] === '')).map(f => f.l);
  if (missing.length) { const e = $('#frm-err'); e.hidden = false; e.textContent = 'Preencha: ' + missing.join(', ') + '.'; return; }
  const st = $('#f-status').value; const now = new Date().toISOString(); const por = myName();
  const hist = (old?.historico || []).slice();
  if (!old) hist.push({ em: now, txt: 'Cadastrado como “' + st + '”', por });
  else if (old.status !== st) hist.push({ em: now, txt: 'Situação: ' + old.status + ' → ' + st, por });
  rec.status = st; rec.historico = hist.slice(-100);
  const btn = $('#btn-save'); btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    let row = await store.saveRow(mod, id, rec);
    upsertLocal(mod, row);
    closeDrawer(); toast(old ? 'Alterações salvas' : 'Registro criado');
    if (mod === 'agenda' && gcal.isConnected()) {
      try { const gid = await gcal.pushEvent(row); if (gid !== (row.google_event_id || null)) { row = await store.saveRow('agenda', row.id, { google_event_id: gid }); upsertLocal('agenda', row); } toast('Google Agenda atualizado'); }
      catch (e) { toast('Salvo aqui, mas não no Google: ' + errMsg(e)); }
    }
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Salvar';
    const el = $('#frm-err'); el.hidden = false; el.textContent = 'Não foi possível salvar: ' + errMsg(e);
  }
}

function upsertLocal(mod, row) { if (!row) return; const a = data[mod]; const i = a.findIndex(x => x.id === row.id); if (i >= 0) a[i] = row; else a.unshift(row); render(); }

/* ---------- documentos Word ---------- */
function docTipo(mod, r) {
  if (mod === 'servicos') return r.tipo_doc === 'Indicação' ? 'indicacao' : r.tipo_doc === 'Requerimento' ? 'requerimento' : (!r.tipo_doc || r.tipo_doc === 'Ofício') ? 'oficio' : null;
  if (mod === 'proposituras') return r.tipo === 'Indicação' ? 'indicacao' : r.tipo === 'Requerimento' ? 'requerimento' : null;
  return null;
}
function proximoNumero(mod, r, ano) {
  let nums;
  if (mod === 'servicos') nums = data.servicos.filter(x => x.tipo_doc === r.tipo_doc || (!x.tipo_doc && !r.tipo_doc)).map(x => /^(\d+)\s*\/\s*(\d{4})$/.exec(x.protocolo || '')).filter(m => m && m[2] === String(ano)).map(m => +m[1]);
  else nums = data.proposituras.filter(x => x.tipo === r.tipo && String(x.ano) === String(ano)).map(x => parseInt(x.numero, 10)).filter(n => !isNaN(n));
  if (String(ano) === String(new Date().getFullYear()) && +cfg.ultimo_oficio) nums.push(+cfg.ultimo_oficio);
  return String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0');
}
async function gerarDocumento() {
  const { mod, id } = drawer; let r = data[mod].find(x => x.id === id); if (!r) return;
  const btn = $('#btn-doc'); if (btn) { btn.disabled = true; btn.textContent = 'Gerando…'; }
  let tipo = docTipo(mod, r);
  try {
    // grava antes o que foi digitado no formulário
    const form = readForm(mod); const st = $('#f-status').value;
    if (MODS[mod].fields.some(f => f.req && (form[f.k] == null || form[f.k] === ''))) throw new Error('Preencha os campos obrigatórios antes de gerar o documento.');
    const mudou = Object.keys(form).some(k => String(form[k] ?? '') !== String(r[k] ?? '')) || st !== r.status;
    if (mudou) { const hist = (r.historico || []).slice(); if (st !== r.status) hist.push({ em: new Date().toISOString(), txt: 'Situação: ' + r.status + ' → ' + st, por: myName() }); r = await store.saveRow(mod, r.id, { ...form, status: st, historico: hist }); upsertLocal(mod, r); }
    tipo = docTipo(mod, r); if (!tipo) throw new Error('Este tipo de documento não tem modelo de Word.');
    const ano = new Date().getFullYear();
    let numero, anoDoc = ano;
    if (tipo !== 'oficio') {
      numero = (mod === 'proposituras' ? r.numero : r.protocolo) || ''; anoDoc = (mod === 'proposituras' && r.ano) || ano;
    } else if (mod === 'servicos') {
      const m = /^(\d+)\s*\/\s*(\d{4})$/.exec(r.protocolo || '');
      if (m) { numero = m[1]; anoDoc = +m[2]; }
      else if (!r.protocolo) { numero = proximoNumero(mod, r, ano); r = await store.saveRow(mod, r.id, { protocolo: numero + '/' + ano, data_envio: r.data_envio || todayStr() }); upsertLocal(mod, r); }
      else numero = r.protocolo;
    } else {
      anoDoc = r.ano || ano;
      if (r.numero) numero = r.numero; else { numero = proximoNumero(mod, r, anoDoc); r = await store.saveRow(mod, r.id, { numero, ano: anoDoc }); upsertLocal(mod, r); }
    }
    const assunto = (mod === 'servicos' ? r.servico : r.ementa) || '';
    const munUf = r.municipio || '';
    const localTxt = mod === 'servicos' ? [r.local && ', na ' + r.local, r.municipio && ', no município de ' + r.municipio].filter(Boolean).join('') : '';
    const linhas = t => String(t || '').split(/\n+/).map(x => x.trim()).filter(Boolean);
    const destOrg = [r.destinatario, r.orgao].filter(Boolean).join(', ') || 'órgão competente';
    const minusc = t => t ? t.charAt(0).toLowerCase() + t.slice(1) : t;
    const paragrafos = linhas(r.corpo).length && tipo === 'oficio' ? linhas(r.corpo) : [
      `Solicito ${minusc(assunto)}${localTxt}.`,
      r.solicitante ? `A solicitação atende à demanda encaminhada ao gabinete por ${r.solicitante}.` : 'A solicitação atende à demanda encaminhada ao gabinete.',
      'Solicito, ainda, retorno a este gabinete sobre as providências adotadas e a previsão de atendimento.',
    ];
    const texto = r.texto || (tipo === 'indicacao'
      ? `INDICO, nos termos regimentais desta Casa de Leis, que seja encaminhado expediente ao(à) ${destOrg}, solicitando ${minusc(assunto)}${localTxt}.`
      : `REQUEIRO, nos termos regimentais desta Casa de Leis, ${minusc(assunto)}.`);
    const justificativa = tipo === 'oficio' ? [] : (linhas(r.corpo).length ? linhas(r.corpo) : [r.solicitante ? `A presente proposição atende à demanda apresentada por ${r.solicitante}.` : 'A presente proposição atende à demanda encaminhada ao gabinete.']);
    const [cargo1, partido] = String(cfg.deputado_cargo || '').split('/');
    const valores = {
      ...cfg, numero, ano: anoDoc, data_extenso: docs.dataExtenso(), destinatario: r.destinatario || '', orgao: r.orgao || '',
      destinatario_orgao: [r.destinatario, r.orgao].filter(Boolean).join(', ') || 'órgão competente', municipio_uf: munUf, assunto, local_texto: localTxt, texto, paragrafos, justificativa,
      numero_doc: tipo === 'oficio' ? numero : (numero ? String(numero).split('/')[0] : ''),
      vocativo: r.vocativo || 'Senhor(a)', solicitante: r.solicitante || '',
      gabinete_maiusculo: (cfg.gabinete || '').toLocaleUpperCase('pt-BR'),
      proponente: [cargo1 && cargo1.trim(), cfg.deputado_nome].filter(Boolean).join(' ') + (partido ? '/' + partido.trim() : ''),
    };
    const blob = await docs.gerarDocx(tipo, valores);
    docs.baixar(blob, `${docs.TIPOS[tipo]}${numero ? '-' + String(numero).replace(/\//g, '-') : ''}-${anoDoc}.docx`.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
    const rot = numero ? `${docs.TIPOS[tipo]} nº ${numero}${tipo === 'oficio' ? '/' + anoDoc : ''}` : docs.TIPOS[tipo];
    const hist = (r.historico || []).concat({ em: new Date().toISOString(), txt: `${rot} gerado em Word`, por: myName() }).slice(-100);
    r = await store.saveRow(mod, r.id, { historico: hist }); upsertLocal(mod, r);
    toast(`${rot} gerado`);
    openDrawer(mod, r.id);
  } catch (e) { toast(errMsg(e)); if (btn) { btn.disabled = false; btn.textContent = 'Gerar ' + docs.TIPOS[tipo] + ' (Word)'; } }
}

async function modelosHtml() {
  const out = [];
  for (const [t, nome] of Object.entries(docs.TIPOS)) {
    let info = { proprio: false, nome: 'Modelo padrão' };
    try { const c = await store.getConfig('modelo:' + t); if (c && c.arquivo) info = { proprio: true, nome: c.nome }; } catch { /* ok */ }
    out.push(`<div class="ag-item" style="cursor:default;grid-template-columns:minmax(0,1fr)"><div><div class="t">${nome}</div><div class="m">${info.proprio ? 'Modelo do gabinete: ' + esc(info.nome) : 'Usando o modelo padrão do sistema'}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button class="btn mini" data-mod-baixar="${t}">Baixar modelo atual</button><label class="btn mini" style="cursor:pointer">Enviar meu modelo (.docx)<input type="file" accept=".docx" data-mod-enviar="${t}" hidden></label>${info.proprio ? `<button class="btn mini ghost" data-mod-padrao="${t}">Voltar ao padrão</button>` : ''}</div></div></div>`);
  }
  return out.join('');
}

/* ---------- Google Agenda ---------- */
async function syncGoogle() {
  const stat = $('#g-stat'); const btn = $('#g-sync');
  try {
    if (!gcal.isConnected()) { await gcal.connect(); }
    if (btn) { btn.disabled = true; btn.textContent = 'Sincronizando…'; }
    const evs = await gcal.fetchEvents();
    let novos = 0, atual = 0, enviados = 0;
    for (const e of evs) {
      const ex = data.agenda.find(r => r.google_event_id === e.google_event_id);
      if (!ex) { const row = await store.saveRow('agenda', null, { ...e, status: 'Confirmado', historico: [{ em: new Date().toISOString(), txt: 'Importado do Google Agenda', por: myName() }] }); upsertLocal('agenda', row); novos++; }
      else if (ex.titulo !== e.titulo || ex.data !== e.data || hhmm(ex.inicio) !== (e.inicio || '') || hhmm(ex.fim) !== (e.fim || '') || (ex.local || null) !== e.local) {
        const row = await store.saveRow('agenda', ex.id, { titulo: e.titulo, data: e.data, inicio: e.inicio, fim: e.fim, local: e.local }); upsertLocal('agenda', row); atual++;
      }
    }
    const t = todayStr();
    for (const r of data.agenda.filter(r => !r.google_event_id && r.data >= t && r.status !== 'Cancelado')) {
      const gid = await gcal.pushEvent(r); const row = await store.saveRow('agenda', r.id, { google_event_id: gid }); upsertLocal('agenda', row); enviados++;
    }
    toast(`Google Agenda: ${novos} importado(s), ${atual} atualizado(s), ${enviados} enviado(s)`);
  } catch (e) { toast(errMsg(e)); if (stat) stat.textContent = errMsg(e); }
  render();
}

/* ---------- exportação (CSV para Excel) ---------- */
function exportCsv() {
  const m = state.view; if (!MODS[m]) return; const M = MODS[m];
  const cols = [['status', 'Situação']].concat(M.fields.map(f => [f.k, f.l])).concat([['criado_em', 'Cadastrado em']]);
  const cell = v => { v = v == null ? '' : String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const rows = filtered(m).map(r => cols.map(([k]) => { let v = r[k]; if (typeof v === 'number' && /valor/.test(k)) v = v.toLocaleString('pt-BR', { minimumFractionDigits: 2 }); if (k === 'criado_em') v = fmtStamp(v); return cell(v); }).join(';'));
  const csv = '﻿' + cols.map(c => cell(c[1])).join(';') + '\n' + rows.join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = m + '-' + todayStr() + '.csv'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/* ---------- eventos ---------- */
document.addEventListener('click', e => {
  if (e.target.closest('[data-stop]')) { e.stopPropagation(); return; }
  const g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); go(g.dataset.go); return; }
  const o = e.target.closest('[data-open]'); if (o) { const [m, id] = o.dataset.open.split(':'); openDrawer(m, id); return; }
  if (e.target.closest('[data-close]')) { closeDrawer(); return; }
  const f = e.target.closest('[data-filter]'); if (f) { state.filter = f.dataset.filter; render(); return; }
  const w = e.target.closest('[data-win]'); if (w) { state.agendaWin = w.dataset.win; render(); return; }
  const nf = e.target.closest('[data-new-for]'); if (nf) { const p = data.pessoas.find(x => x.id === drawer.id); closeDrawer(); go(nf.dataset.newFor); openDrawer(nf.dataset.newFor, null, { solicitante: p?.nome, telefone: p?.telefone, municipio: p?.municipio, bairro: p?.bairro }); return; }
  const sr = e.target.closest('[data-search]'); if (sr) { const q = sr.dataset.search; closeDrawer(); go('demandas'); state.q = q; state.filter = 'todos'; render(); return; }
  if (e.target.closest('#btn-new')) { openDrawer(state.view === 'painel' ? 'demandas' : state.view, null); return; }
  if (e.target.closest('#btn-export')) { exportCsv(); return; }
  if (e.target.closest('#btn-save')) { saveDrawer(); return; }
  if (e.target.closest('#btn-del')) { $('#del-zone').innerHTML = '<span class="confirm">Excluir de vez? <button class="btn danger" id="btn-del-yes" type="button">Sim, excluir</button><button class="btn ghost" id="btn-del-no" type="button">Não</button></span>'; return; }
  if (e.target.closest('#btn-del-no')) { $('#del-zone').innerHTML = '<button class="btn danger" id="btn-del" type="button">Excluir</button>'; return; }
  if (e.target.closest('#btn-del-yes')) {
    const { mod, id } = drawer; const rec = data[mod].find(r => r.id === id);
    store.deleteRow(mod, id).then(async () => {
      data[mod] = data[mod].filter(x => x.id !== id); closeDrawer(); render(); toast('Registro excluído');
      if (mod === 'agenda' && rec?.google_event_id && gcal.isConnected()) { try { await gcal.pushEvent({ ...rec, status: 'Cancelado' }); } catch { /* ok */ } }
    }).catch(err => toast('Não foi possível excluir: ' + errMsg(err)));
    return;
  }
  if (e.target.closest('#g-sync')) { syncGoogle(); return; }
  if (e.target.closest('#btn-doc')) { gerarDocumento(); return; }
  const eqd = e.target.closest('[data-eq-del]'); if (eqd) { const em = eqd.dataset.eqDel; if (eqd.dataset.ok) { store.removeEquipe(em).then(() => { toast('Acesso removido'); render(); }).catch(err => toast(errMsg(err))); } else { eqd.dataset.ok = '1'; eqd.textContent = 'Confirmar remoção'; eqd.classList.add('danger'); } return; }
  const mb = e.target.closest('[data-mod-baixar]'); if (mb) { docs.carregarModelo(mb.dataset.modBaixar).then(m => docs.baixar(new Blob([m.buf]), 'modelo-' + mb.dataset.modBaixar + '.docx')).catch(err => toast(errMsg(err))); return; }
  const mp = e.target.closest('[data-mod-padrao]'); if (mp) { store.setConfig('modelo:' + mp.dataset.modPadrao, null).then(() => { toast('Voltou ao modelo padrão'); render(); }).catch(err => toast(errMsg(err))); return; }
  if (e.target.closest('#g-cal-save')) { gcal.setCalendarId($('#g-cal').value.trim()); toast('Calendário salvo'); return; }
  if (e.target.closest('#et-print')) { window.print(); return; }
  if (e.target.closest('#pf-sair')) { store.signOut(); return; }
  if (e.target.closest('#pf-senha')) { renderSetPassword(); return; }
});
document.addEventListener('change', async e => {
  const t = e.target.dataset && e.target.dataset.modEnviar; if (!t) return;
  const f = e.target.files[0]; if (!f) return;
  try {
    if (f.size > 3e6) throw new Error('O arquivo passa de 3 MB. Diminua as imagens do modelo.');
    const buf = await f.arrayBuffer();
    try { docs.validarModelo(buf); } catch (err) { throw new Error('Não consegui ler esse modelo. Confira se é um .docx e se os campos estão escritos como {numero}.'); }
    await store.setConfig('modelo:' + t, { nome: f.name, arquivo: docs.bufToB64(buf) });
    toast('Modelo enviado'); render();
  } catch (err) { toast(errMsg(err)); }
});
document.addEventListener('submit', async e => {
  if (e.target.id === 'eq-add') {
    e.preventDefault(); const em = $('#eq-email').value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { toast('Digite um e-mail válido'); return; }
    try { await store.addEquipe(em); toast('E-mail liberado'); render(); } catch (err) { toast(/duplicate/i.test(errMsg(err)) ? 'Esse e-mail já está liberado' : errMsg(err)); }
    return;
  }
  if (e.target.id === 'cfg') {
    e.preventDefault();
    const v = Object.fromEntries(CFG_CAMPOS.map(([k]) => [k, $('#cfg-' + k).value.trim()]));
    try { await store.setConfig('gabinete', v); Object.assign(cfg, v); document.title = NOME_GAB(); shell(); render(); toast('Dados do gabinete salvos'); } catch (err) { toast(errMsg(err)); }
    return;
  }
  if (e.target.id !== 'perfil') return; e.preventDefault();
  const n = $('#pf-nome').value.trim(); if (!n) return;
  try { await store.saveProfile(state.session.user.id, n); state.profiles = await store.loadProfiles(); toast('Nome salvo'); render(); } catch (err) { toast(errMsg(err)); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'q') { state.q = e.target.value; render(); }
  if (e.target.dataset && e.target.dataset.et) { state.et[e.target.dataset.et] = e.target.value; const pos = e.target.id; render(); const el = document.getElementById(pos); if (el) el.focus(); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && drawer.open) closeDrawer(); if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && drawer.open) saveDrawer(); });

/* ---------- inicialização ---------- */
let unsub = null;
async function startApp() {
  if (store.configured) {
    state.session = await store.getSession();
    if (!state.session) return renderLogin();
    if (mustSetPassword) return renderSetPassword();
    if ((await store.isEquipe()) === false) return renderSemAcesso();
  } else state.session = await store.getSession();
  try { state.profiles = await store.loadProfiles(); } catch { state.profiles = []; }
  try { const c = await store.getConfig('gabinete'); if (c) Object.entries(c).forEach(([k, v]) => { if (v) cfg[k] = v; }); } catch { /* usa os padrões */ }
  document.title = NOME_GAB();
  if (store.configured && !state.profiles.some(p => p.id === state.session.user.id)) return renderAskName();
  readHash();
  if (!location.hash) history.replaceState(null, '', location.pathname + '#painel');
  shell(); render();
  try {
    const all = await Promise.all(ORDER.map(m => store.loadAll(m)));
    ORDER.forEach((m, i) => { data[m] = all[i]; });
    state.loaded = true;
  } catch (e) { toast('Erro ao carregar dados: ' + errMsg(e)); }
  render();
  if (unsub) unsub();
  unsub = store.subscribe((m, type, nw, old) => {
    if (type === 'DELETE') data[m] = data[m].filter(r => r.id !== old.id);
    else { const i = data[m].findIndex(r => r.id === nw.id); if (i >= 0) data[m][i] = nw; else data[m].unshift(nw); }
    render();
  });
}

store.onAuth((ev) => {
  if (ev === 'PASSWORD_RECOVERY') { mustSetPassword = true; renderSetPassword(); }
  else if (ev === 'SIGNED_IN' && !$('#main')) startApp();
  else if (ev === 'SIGNED_OUT') { if (unsub) unsub(); renderLogin(); }
});
startApp();
