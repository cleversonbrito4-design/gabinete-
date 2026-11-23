import './style.css';
import { MODS, ORDER, AREAS_DEMANDA } from './schema.js';
import * as store from './store.js';
import * as gcal from './google.js';
import { MODELOS, folhas } from './etiquetas.js';
import * as docs from './documentos.js';
import * as imp from './importar.js';
import * as mapaLib from './mapa.js';
import * as ags from './agendas.js';

/* Dados do gabinete: editáveis em "Minha conta"; os do .env são só o ponto de partida. */
const env = import.meta.env;
const CFG_CAMPOS = [
  ['gabinete', 'Nome do gabinete', env.VITE_NOME_GABINETE || 'Gestão do Gabinete'],
  ['deputado_nome', 'Nome do parlamentar (como assina)', env.VITE_DEPUTADO_NOME || ''],
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
function toastAcao(msg, href, label) {
  document.querySelectorAll('.toast.acao').forEach(t => t.remove());
  const t = document.createElement('div'); t.className = 'toast acao';
  t.innerHTML = `<span>${esc(msg)}</span><a class="btn wa mini" href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}</a><button class="btn mini ghost" type="button" aria-label="Fechar">✕</button>`;
  t.querySelector('button').addEventListener('click', () => t.remove()); t.querySelector('a').addEventListener('click', () => setTimeout(() => t.remove(), 300));
  document.body.appendChild(t); setTimeout(() => t.remove(), 15000);
}
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
/* Mensagens de WhatsApp: editáveis em Minha conta → Mensagens prontas. */
const MSG_PADRAO = {
  contato: ['Contato geral', 'Olá, {nome}! Aqui é do gabinete do {vereador}.'],
  registrado: ['Pedido registrado (protocolo)', 'Olá, {nome}! Aqui é do gabinete do {vereador}. Recebemos o seu pedido "{assunto}". Seu número de protocolo é {protocolo}. Para acompanhar a situação, acesse {link_consulta} e digite o protocolo e o seu celular.'],
  andamento: ['Pedido em andamento', 'Olá, {nome}! Aqui é do gabinete do {vereador}. Atualização sobre o seu pedido "{assunto}": a situação agora é "{situacao}". Assim que houver novidade, avisamos você.'],
  oficio: ['Ofício enviado', 'Olá, {nome}! Aqui é do gabinete do {vereador}. Sobre o seu pedido "{assunto}": enviamos ofício para {orgao}. Assim que tivermos resposta, avisamos você.'],
  concluida: ['Pedido concluído', 'Olá, {nome}! Aqui é do gabinete do {vereador}. Seu pedido "{assunto}" foi concluído! Ficamos felizes em ajudar. Pode nos dar uma nota de 1 a 5? Leva 10 segundos: {link_avaliacao}'],
  negado: ['Pedido não atendido', 'Olá, {nome}! Aqui é do gabinete do {vereador}. Sobre o seu pedido "{assunto}": infelizmente a situação é "{situacao}". Se precisar de algo mais, estamos à disposição.'],
  aniversario: ['Aniversário', 'Olá, {nome}! O {vereador} e toda a equipe do gabinete desejam a você um feliz aniversário, com muita saúde e alegria!'],
  convite: ['Convite para evento', 'Olá, {nome}! O {vereador} convida você para {evento}, no dia {data}{hora}{local}. Contamos com sua presença!'],
};
let msgs = {}; // textos salvos pela equipe
const msgTexto = tipo => msgs[tipo] || MSG_PADRAO[tipo][1];
function msg(tipo, vars) {
  let t = msgTexto(tipo);
  const v = { vereador: DEP(), ...vars };
  // sem link de avaliação, tira a frase que pede a nota
  if (!v.link_avaliacao) t = t.replace(/[^.!?]*\{link_avaliacao\}[^.!?]*[.!?]?/g, '').replace(/\s+$/, '');
  for (const k of ['protocolo', 'link_consulta']) if (!v[k]) t = t.replace(new RegExp('[^.!?]*\\{' + k + '\\}[^.!?]*[.!?]?', 'g'), '').replace(/\s+$/, '');
  return t.replace(/\{(\w+)\}/g, (_, k) => v[k] == null ? '' : String(v[k])).replace(/ {2,}/g, ' ').trim();
}
const linkConsulta = p => location.origin + location.pathname + '?consulta' + (p ? '=' + encodeURIComponent(p) : '');
const linkAvaliacao = r => { const tk = r && (r.avaliacao_token || (!store.configured && r.id)); return tk ? location.origin + location.pathname + '?avaliar=' + tk : ''; };
/** Troca {nome}, {evento}… num texto livre. Campos desconhecidos ficam como estão. */
const preencher = (t, v) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => k in v ? String(v[k] ?? '') : m);
function waTexto(mod, r) {
  if (mod === 'pessoas' || mod === 'recepcao') return msg('contato', { nome: primeiroNome(r.nome) });
  if (mod === 'demandas' || mod === 'servicos') return waStatus(mod, r);
  return '';
}
function waStatus(mod, r) {
  const k = kindOf(mod, r.status);
  const vars = { nome: primeiroNome(r.solicitante), assunto: mod === 'demandas' ? r.assunto : r.servico, situacao: r.status, orgao: r.orgao || 'o órgão responsável', link_avaliacao: mod === 'demandas' ? linkAvaliacao(r) : '',
    protocolo: r.protocolo || '', link_consulta: r.protocolo ? linkConsulta(r.protocolo) : '' };
  if (k === 'novo' && mod === 'demandas' && r.protocolo) return msg('registrado', vars);
  if (k === 'ok') return msg('concluida', vars);
  if (k === 'neg') return msg('negado', vars);
  if (mod === 'servicos' && r.status === 'Ofício enviado') return msg('oficio', vars);
  return msg('andamento', vars);
}
const waAniversario = p => msg('aniversario', { nome: primeiroNome(p.nome) });

/* ---------- estado ---------- */
const data = Object.fromEntries(ORDER.map(m => [m, []]));
const state = { rota: [], cal: '', disp: null, rem: { ano: '', municipio: '' }, cid: null, mapa: { mod: 'demandas', so: 'abertos', per: '', org: '' }, imp: { mod: 'pessoas' }, rel: { mod: 'demandas', de: '', ate: '', municipio: '', bairro: '', status: '' }, view: 'painel', q: '', filter: 'abertos', agendaWin: 'proximos', loaded: false, session: null, profiles: [], et: { tipo: '', grupo: '', municipio: '', mes: '', modelo: '6180', pular: 0 } };
const drawer = { open: false, mod: null, id: null, geo: null };
let geoMini = null; // mapinha aberto dentro do registro
let pedidoInstalar = null; // convite do navegador para instalar o app
const VIEWS = ['agendas', 'graficos', 'admin', 'disparo', 'painel', 'etiquetas', 'conta', 'relatorios', 'importar', 'mapa', 'resumo-emendas', 'cidadao', ...ORDER];

function readHash() { const h = location.hash.slice(1); if (VIEWS.includes(h)) state.view = h; }
window.addEventListener('hashchange', () => { readHash(); state.q = state.qNext || ''; state.filter = state.qNext ? 'todos' : 'abertos'; state.qNext = ''; render(); });
function go(v) { if (location.hash !== '#' + v) location.hash = v; else { state.view = v; render(); } window.scrollTo(0, 0); }

/* ---------- login ---------- */
const authHash = window.__authHash || '';
let mustSetPassword = /type=(invite|recovery)/.test(authHash);

let loginMode = 'entrar';
/** Marca Fala Cascavel nas telas de entrada e páginas abertas ao cidadão. */
const marcaPub = () => `<div class="pt-badge"><span class="pt-dot" aria-hidden="true"></span>${esc(NOME_GAB())}</div>`;
/** Topo das páginas abertas: logo sem fundo à esquerda e um botão em pílula à direita (estilo vidro, fundo escuro). */
const ACOES_PORTAL = { pedido: ['?solicitar', 'Fazer um pedido'], consulta: ['?consulta', 'Acompanhar pedido'], equipe: ['/', 'Entrar'] };
const topoPortal = (acao = '', semLogo = false) => { const a = ACOES_PORTAL[acao]; return `<div class="pt-fundo" aria-hidden="true"><i></i><i></i><i></i></div><header class="pt-top${semLogo ? ' sem-logo' : ''}"><a class="pt-logo" href="${a && acao !== 'equipe' ? '?solicitar' : '/'}"><img src="/marca/fala-cascavel-branca.svg" alt="Fala Cascavel" width="190" height="61"></a>${a ? `<a class="pt-acao" href="${a[0]}">${a[1]}</a>` : ''}</header>`; };
const tituloPortal = (t, sub = '') => `<h1 class="pt-h1">${t}</h1>${sub ? `<p class="pt-sub">${sub}</p>` : ''}`;
function renderLogin(msg = '', ok = '', email = '') {
  const criar = loginMode === 'criar';
  document.body.innerHTML = `<div class="login portal">${topoPortal('pedido', true)}<form class="login-card" id="login" novalidate>
    <img class="pt-logo-card" src="/marca/fala-cascavel-branca.svg" alt="Fala Cascavel" width="240" height="77">
    ${tituloPortal(criar ? 'Criar minha conta' : 'Entrar no sistema', criar ? 'Use o e-mail que a equipe liberou para você.' : 'Área da equipe do gabinete.')}
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
  document.body.innerHTML = `<div class="login portal">${topoPortal()}<form class="login-card" id="setpw" novalidate>
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
  document.body.innerHTML = `<div class="login portal">${topoPortal()}<div class="login-card">
    <h1>Acesso ainda não liberado</h1>
    <p class="m">O e-mail <b>${esc(em)}</b> entrou, mas ainda não está na lista da equipe do gabinete.</p>
    <p class="m">Peça para alguém da equipe abrir <b>☰ → Minha conta → Equipe</b> e incluir este e-mail. Depois toque em "Tentar de novo".</p>
    <button class="btn primary" id="sa-retry" style="justify-content:center">Tentar de novo</button>
    <button class="linkbtn" id="sa-sair">Sair</button></div></div>`;
  $('#sa-retry').addEventListener('click', () => startApp());
  $('#sa-sair').addEventListener('click', () => store.signOut());
}

function renderAskName(msg = '') {
  document.body.innerHTML = `<div class="login portal">${topoPortal()}<form class="login-card" id="askname" novalidate>
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
    <div class="brand-l"><a href="#painel" class="logo-top" aria-label="Fala Cascavel – início"><img class="lg-claro" src="/marca/fala-cascavel.svg" alt="Fala Cascavel"><img class="lg-escuro" src="/marca/fala-cascavel-branca.svg" alt="Fala Cascavel"></a><h1>${esc(NOME_GAB())}<small>Demandas, ofícios, emendas, proposituras, agenda e pessoas</small></h1></div>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="btn ghost" id="btn-tema" type="button" title="Mudar tema claro/escuro" aria-label="Mudar tema claro/escuro">${document.documentElement.dataset.theme === "light" ? "🌙" : "☀️"}</button>
      <button class="btn ghost bell" id="btn-avisos" title="Avisos" aria-label="Avisos">🔔<span class="n" id="avisos-n" hidden></span></button>
      <button class="btn" id="btn-import" hidden>Importar</button>
      <button class="btn" id="btn-export" hidden>Exportar</button>
      <button class="btn btn-agenda" data-go="agenda" title="Abrir a agenda" aria-label="Agenda">📅<span class="ag-txt">Agenda</span></button>
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
  const tabs = [['painel', 'Painel', null]].concat(ORDER.map(m => [m, MODS[m].label, data[m].filter(r => isOpen(m, r)).length]), [['relatorios', 'Relatórios', null]]);
  const cur = state.view === 'graficos' ? 'relatorios' : state.view === 'disparo' ? 'pessoas' : state.view === 'resumo-emendas' ? 'emendas' : state.view === 'cidadao' ? 'pessoas' : state.view === 'etiquetas' ? 'pessoas' : state.view === 'agendas' ? 'agenda' : state.view === 'importar' ? state.imp.mod : state.view === 'mapa' ? state.mapa.mod : state.view;
  $('#tabs').innerHTML = tabs.map(([k, l, n]) => `<button class="tab" role="tab" data-go="${k}" aria-selected="${cur === k}">${l}${n != null ? `<span class="n">${n}</span>` : ''}</button>`).join('');
  const nb = $('#btn-new');
  nb.hidden = ['agendas', 'conta', 'etiquetas', 'relatorios', 'importar', 'mapa', 'resumo-emendas', 'cidadao'].includes(state.view);
  nb.textContent = '+ ' + (state.view === 'painel' ? MODS.demandas.novo : MODS[state.view]?.novo || 'Novo');
  $('#btn-export').hidden = !MODS[state.view];
  $('#btn-import').hidden = !MODS[state.view];
  const nAv = avisos().urgentes; const an = $('#avisos-n'); an.hidden = !nAv; an.textContent = nAv;
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
  carregarExternas();
  const proxExt = extEventos().filter(e => e.data >= t && e.data <= w);
  const proxTudo = prox.concat(proxExt).sort((a, b) => (a.data + hhmm(a.inicio)).localeCompare(b.data + hhmm(b.inicio))).slice(0, 10);
  const agHtml = proxTudo.length ? proxTudo.map(r => r.ext ? `<div class="ag-item ext-item" style="--cor:${esc(r.cor)}" data-ext="${esc(extTitulo(r))}"><div class="ag-when"><b>${r.data === t ? 'Hoje' : fmtDate(r.data)}</b>${esc(hhmm(r.inicio))}</div><div style="min-width:0"><div class="t">${esc(r.titulo)}</div><div class="m">${esc(r.local || '')}</div></div><span class="pill ext-pill">${esc(r.agenda)}</span></div>` : `<div class="ag-item" data-open="agenda:${r.id}"><div class="ag-when"><b>${r.data === t ? 'Hoje' : fmtDate(r.data)}</b>${esc(hhmm(r.inicio))}</div><div style="min-width:0"><div class="t">${esc(r.titulo)}</div><div class="m">${esc(MODS.agenda.meta(r))}</div></div><span class="pill ${STATUS_KIND[kindOf('agenda', r.status)]}">${esc(r.status)}</span></div>`).join('')
    : `<div class="empty"><b>Nada marcado para os próximos 7 dias</b>Use “Novo compromisso” na aba Agenda.</div>`;

  const md = s => s.slice(5); const days = [...Array(8)].map((_, i) => md(addDays(t, i)));
  const aniv = data.pessoas.filter(r => r.nascimento && r.status !== 'Inativo' && days.includes(md(r.nascimento))).sort((a, b) => days.indexOf(md(a.nascimento)) - days.indexOf(md(b.nascimento)));
  const anivHtml = aniv.length ? aniv.slice(0, 10).map(r => { const wa = waLink(r.telefone, waAniversario(r)); return `<div class="ag-item" data-open="pessoas:${r.id}"><div class="ag-when"><b>${md(r.nascimento) === md(t) ? 'Hoje' : r.nascimento.slice(8, 10) + '/' + r.nascimento.slice(5, 7)}</b></div><div style="min-width:0"><div class="t">${esc(r.nome)}</div><div class="m">${esc([r.tipo, r.municipio].filter(Boolean).join(' · '))}</div></div>${wa ? `<a class="btn wa mini" href="${esc(wa)}" target="_blank" rel="noopener" data-stop>Parabenizar</a>` : ''}</div>`; }).join('')
    : `<div class="empty"><b>Nenhum aniversário nos próximos 7 dias</b>Cadastre a data de aniversário na aba Pessoas.</div>`;

  const anivHoje = aniv.filter(r => md(r.nascimento) === md(t) && r.telefone);
  const anivBtn = anivHoje.length > 1 ? `<div style="margin-top:8px"><button class="btn mini wa" data-disp-aniv>Parabenizar os ${anivHoje.length} de hoje, um por um</button></div>` : '';
  const notas = data.demandas.filter(r => r.nota != null);
  const media = notas.length ? notas.reduce((a, r) => a + +r.nota, 0) / notas.length : 0;
  const conc = data.demandas.filter(r => r.status === 'Concluída').length;
  const estrelas = n => '★★★★★'.slice(0, Math.round(n)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(n));
  const satHtml = notas.length ? `<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><b style="font-family:var(--display);font-size:30px">${media.toFixed(1).replace('.', ',')}</b><span class="estrelas">${estrelas(media)}</span><span class="m">${notas.length} avaliação(ões) · ${conc ? Math.round(notas.length / conc * 100) : 0}% das demandas concluídas</span></div>`
      + notas.filter(r => r.nota_comentario).sort((a, b) => String(b.nota_em || '').localeCompare(String(a.nota_em || ''))).slice(0, 3).map(r => `<div class="ag-item" data-open="demandas:${r.id}"><div class="ag-when"><b class="estrelas">${'★'.repeat(+r.nota)}</b></div><div style="min-width:0"><div class="t">“${esc(r.nota_comentario)}”</div><div class="m">${esc([r.solicitante, r.assunto].filter(Boolean).join(' · '))}</div></div></div>`).join('')
    : `<div class="empty"><b>Nenhuma avaliação ainda</b>Ao concluir uma demanda, toque em WhatsApp: a mensagem já leva o link para o cidadão dar a nota.</div>`;
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

  return `${banner()}<div class="eyebrow">${fmtDay(t)}</div><div class="ola"><h2 class="sec">Olá${myName() ? ', ' + esc(primeiroNome(myName())) : ''}</h2><button class="btn primary" type="button" data-novo="agenda">+ Compromisso</button></div>
    <div class="kpis">${kpis}</div>
    <div class="cols">
      <div style="display:flex;flex-direction:column;gap:18px;min-width:0">
        <section class="panel"><h3>Próximos 7 dias na agenda <a data-go="agenda">ver agenda</a></h3>${agHtml}<button class="btn primary mini-full" type="button" data-novo="agenda">+ Compromisso</button></section>
        <section class="panel"><h3>Minhas tarefas <a data-go="tarefas">ver tarefas</a></h3>${minhasTarefasHtml()}</section>
        <section class="panel"><h3>Aniversariantes da semana <a data-go="pessoas">ver pessoas</a></h3>${anivHtml}${anivBtn}</section>
      </div>
      <div style="display:flex;flex-direction:column;gap:18px;min-width:0">
        <section class="panel"><h3>Prazos a cobrar</h3>${pendHtml}</section>
        <section class="panel"><h3>Emendas por situação <a data-go="emendas">ver emendas</a></h3>${emHtml}</section>
        <section class="panel"><h3>Satisfação do cidadão</h3>${satHtml}</section>
        <section class="panel"><h3>Demandas abertas por município <a data-go="mapa">ver mapa</a></h3>${munHtml}</section>
      </div>
    </div>`;
}

function minhasTarefasHtml() {
  const eu = myName(), t = todayStr();
  const a = data.tarefas.filter(r => isOpen('tarefas', r) && (!r.responsavel || r.responsavel === eu)).sort((x, y) => String(x.prazo || '9999').localeCompare(String(y.prazo || '9999'))).slice(0, 8);
  if (!a.length) return `<div class="empty"><b>Nenhuma tarefa pendente com você</b>Crie em Tarefas, ou dentro de uma demanda em “+ Tarefa”.</div>`;
  return a.map(r => `<div class="ag-item" data-open="tarefas:${r.id}"><div class="ag-when"><b>${r.prazo ? (r.prazo === t ? 'Hoje' : fmtDate(r.prazo)) : '—'}</b>${r.responsavel ? '' : 'sem dono'}</div><div style="min-width:0"><div class="t">${esc(r.titulo)}</div><div class="m">${esc(r.relacionado || '')}</div></div><span class="pill ${isLate('tarefas', r) ? 'k-late' : STATUS_KIND[kindOf('tarefas', r.status)]}">${isLate('tarefas', r) ? 'Atrasada' : esc(r.status)}</span></div>`).join('');
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
    else if (state.filter === 'pedidos') { const c = contagemPedidos(); a = a.filter(r => c.get(r.id)); }
    else if (state.filter === 'aniv') { const mm = t.slice(5, 7); a = a.filter(r => r.nascimento && r.nascimento.slice(5, 7) === mm).sort((x, y) => x.nascimento.slice(8).localeCompare(y.nascimento.slice(8))); }
    if (state.filter !== 'aniv') a.sort((x, y) => String(x.nome || '').localeCompare(String(y.nome || ''), 'pt-BR'));
  } else {
    if (state.filter === 'abertos') a = a.filter(r => isOpen(m, r));
    else if (state.filter === 'atrasados') a = a.filter(r => isLate(m, r));
    else if (state.filter === 'meus') a = a.filter(r => r.responsavel && r.responsavel === myName());
    else if (state.filter !== 'todos') a = a.filter(r => r.status === state.filter);
    if (m === 'recepcao') { // fila: quem chegou primeiro aparece primeiro
      if (state.filter === 'hoje') a = data.recepcao.filter(r => String(r.criado_em || '').slice(0, 10) === t);
      a.sort((x, y) => (isOpen(m, x) ? 0 : 1) - (isOpen(m, y) ? 0 : 1) || String(isOpen(m, x) ? x.criado_em : y.criado_em || '').localeCompare(String(isOpen(m, x) ? y.criado_em : x.criado_em || '')));
      if (q) a = a.filter(r => Object.values(r).some(v => (typeof v === 'string' || typeof v === 'number') && String(v).toLowerCase().includes(q)));
      return a;
    }
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
  if (m === 'tarefas') return r.prazo ? 'Prazo ' + fmtDate(r.prazo) : '';
  if (m === 'recepcao') { const dia = String(r.criado_em || '').slice(0, 10); return (dia && dia !== todayStr() ? fmtDate(dia) + ' ' : 'Chegou ') + (hhmm(r.hora_chegada) || ''); }
  if (m === 'proposituras') return r.data_protocolo ? 'Protocolo ' + fmtDate(r.data_protocolo) : '';
  if (m === 'pessoas' && state.filter === 'pedidos') { const n = contagemPedidos().get(r.id) || 0; return n + (n > 1 ? ' pedidos' : ' pedido'); }
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
  const M = MODS[m]; let a = filtered(m);
  let chips, extra = '';
  if (m === 'agenda') {
    chips = [['proximos', 'Próximos'], ['mes', 'Calendário do mês'], ['passados', 'Passados'], ['todos', 'Todos']].map(([k, l]) => chip('data-win', k, l, state.agendaWin === k)).join('');
    carregarExternas();
    if (store.configured) extra = `<div class="no-print" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px"><button class="btn mini primary" data-go="agendas">🔗 Ligar com Gmail e outras agendas</button><span class="gstat">${extResumo()}</span></div>`;
    if (gcal.googleAvailable) extra += `<div class="no-print" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px"><button class="btn mini" id="g-sync">${gcal.isConnected() ? 'Sincronizar com Google Agenda' : 'Conectar Google Agenda'}</button><span class="gstat" id="g-stat">${gcal.isConnected() ? 'Conectado · calendário: ' + esc(gcal.calendarId()) : 'Compromissos salvos aqui vão para o Google Agenda do parlamentar.'}</span></div>`;
  } else if (m === 'pessoas') {
    chips = [['abertos', 'Ativos'], ['pedidos', 'Fizeram pedidos'], ['tipo:Liderança', 'Lideranças'], ['tipo:Entidade / associação', 'Entidades'], ['aniv', 'Aniversariantes do mês'], ['todos', 'Todos']].map(([k, l]) => chip('data-filter', k, l, state.filter === k)).join('');
    extra = `<div class="no-print" style="margin-bottom:4px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn mini" data-go="etiquetas">Imprimir etiquetas</button><button class="btn mini" data-mapa-de="pessoas">Ver no mapa</button><button class="btn mini wa" data-disp-lista>Mensagem para esta lista</button><button class="btn mini" data-vcf>Salvar no celular (contatos)</button></div>`;
    const novos = quemPediuSemCadastro();
    if (novos.length) extra += `<div class="no-print aviso-contatos" style="margin:6px 0;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="m"><b>${novos.length}</b> pessoa(s) que fizeram pedidos ainda não estão na lista.</span><button class="btn mini primary" data-trazer-pedidos>Colocar na lista</button></div>`;
  } else {
    const opts = [['abertos', 'Em aberto']].concat(M.deadline ? [['atrasados', 'Atrasados']] : []).concat(M.fields.some(f => f.k === 'responsavel') ? [['meus', 'Comigo']] : []).concat([['todos', 'Todos']], M.statuses.map(s => [s[0], s[0]]));
    chips = opts.map(([k, l]) => chip('data-filter', k, l, state.filter === k)).join('');
    if (['demandas', 'servicos'].includes(m)) extra = `<div class="no-print" style="margin-bottom:4px"><button class="btn mini" data-mapa-de="${m}">Ver no mapa</button></div>`;
    if (m === 'recepcao') { chips = chip('data-filter', 'abertos', 'Fila agora', state.filter === 'abertos') + chip('data-filter', 'hoje', 'Hoje', state.filter === 'hoje') + chip('data-filter', 'todos', 'Todos', state.filter === 'todos'); const n = data.recepcao.filter(r => r.status === 'Aguardando').length; extra = `<div class="m" style="margin-bottom:4px">${n ? `<b>${n}</b> pessoa(s) aguardando.` : 'Ninguém aguardando agora.'}</div>`; }
    if (m === 'emendas') extra = `<div class="no-print" style="margin-bottom:4px"><button class="btn mini primary" data-go="resumo-emendas">Painel de emendas (indicado, empenhado, pago)</button></div>`;
  }
  let body;
  if (m === 'agenda' && state.agendaWin !== 'mes') a = a.concat(extFiltrados()).sort((x, y) => (x.data + hhmm(x.inicio)).localeCompare(y.data + hhmm(y.inicio)) * (state.agendaWin === 'passados' ? -1 : 1));
  if (!data[m].length && !(m === 'agenda' && (state.agendaWin === 'mes' || a.length))) body = `<div class="empty"><b>Nenhum registro ainda</b>Clique em “+ ${esc(M.novo)}” para cadastrar o primeiro.</div>`;
  else if (!a.length && !(m === 'agenda' && state.agendaWin === 'mes')) body = `<div class="empty"><b>Nada encontrado</b>Mude o filtro ou a busca.</div>`;
  else if (m === 'agenda' && state.agendaWin === 'mes') body = calendarioHtml(a);
  else if (m === 'agenda') {
    const t = todayStr(); let out = '', cur = '';
    a.forEach(r => {
      if (r.data !== cur) { cur = r.data; const n = a.filter(x => x.data === cur).length; out += `<div class="day-h ${cur === t ? 'today' : ''}"><span>${cur === t ? 'Hoje · ' : ''}${fmtDay(cur)}</span><span class="m">${n} compromisso${n > 1 ? 's' : ''}</span></div>`; }
      if (r.ext) { out += `<div class="row ext-row" style="--cor:${esc(r.cor)}" data-ext="${esc(extTitulo(r))}"><div style="min-width:0"><div class="t"><span class="num" style="margin-right:8px;color:var(--muted)">${esc(hhmm(r.inicio) || 'Dia todo')}${r.fim ? '–' + esc(hhmm(r.fim)) : ''}</span>${esc(r.titulo)}</div><div class="m">${esc(r.local || '')}</div></div><div class="mid m"></div><div class="right"><span class="pill ext-pill">${esc(r.agenda)}</span></div></div>`; return; }
      out += `<button class="row" data-open="agenda:${r.id}"><div style="min-width:0"><div class="t"><span class="num" style="margin-right:8px;color:var(--muted)">${esc(hhmm(r.inicio) || 'Dia todo')}${r.fim ? '–' + esc(hhmm(r.fim)) : ''}</span>${esc(r.titulo)}</div><div class="m">${esc(M.meta(r))}${r.google_event_id ? ' · no Google' : ''}</div></div><div class="mid m">${esc(r.contato || '')}</div><div class="right"><span class="pill ${STATUS_KIND[kindOf('agenda', r.status)]}">${esc(r.status)}</span></div></button>`;
    });
    body = out;
  } else body = a.map(r => rowHtml(m, r)).join('');
  return `${banner()}<h2 class="sec">${M.label}</h2><div class="m" style="margin-top:2px">${M.hint}</div>
    <div class="print-only m">Impresso em ${fmtStamp(new Date().toISOString())} · ${a.length} registro(s)</div>
    <div class="toolbar"><input class="search" id="q" type="search" placeholder="Buscar por nome, município, assunto, protocolo…" value="${esc(state.q)}"><div class="chips">${chips}</div></div>
    ${extra}<div class="no-print so-cel" style="margin-bottom:4px;gap:8px;flex-wrap:wrap"><button class="btn mini" data-importar>Importar planilha</button><button class="btn mini" data-exportar>Exportar planilha</button></div><div class="list" id="list">${body}</div>`;
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
    ${state.admin ? `<section class="panel adm-chamada"><h3>Administração</h3><p class="m" style="margin-top:0">Só você vê: último acesso de cada colaborador, liberar e remover e-mails, dados do gabinete, mensagens prontas e modelos de Word.</p><button class="btn primary" data-go="admin">Abrir Administração</button></section>` : ''}
    <section class="panel"><h3>Cópia de segurança</h3>
      <p class="m" style="margin-top:0">Baixa uma planilha do Excel com tudo o que está no sistema, uma aba para cada assunto. Faça uma vez por semana e guarde no Google Drive ou mande para o seu e-mail. O 🔔 avisa quando passar de 7 dias.</p>
      <p class="m">${state.backup?.em ? 'Última cópia: ' + fmtStamp(state.backup.em) + (state.backup.por ? ' por ' + esc(state.backup.por) : '') : 'Nenhuma cópia feita ainda.'}</p>
      <button class="btn primary" type="button" data-backup>Baixar cópia completa (Excel)</button></section>
    <section class="panel"><h3>Usar no celular</h3>
      <p class="m" style="margin-top:0">Instale o sistema na tela inicial do celular ou do computador. Ele abre como um aplicativo, sem a barra do navegador.</p>
      <button class="btn primary" id="btn-instalar" type="button" ${pedidoInstalar ? '' : 'hidden'}>Instalar o aplicativo</button>
      <p class="m"><b>Android (Chrome):</b> menu ⋮ → <i>Instalar app</i> ou <i>Adicionar à tela inicial</i>.<br><b>iPhone (Safari):</b> botão Compartilhar ⬆ → <i>Adicionar à Tela de Início</i>.</p></section>
    ${store.configured ? `<section class="panel"><h3>Prestação de contas pública</h3>
      <p class="m" style="margin-top:0">Página aberta para divulgar nas redes, com o que foi conquistado. Só aparece o que a equipe marcar com <b>"Mostrar na prestação de contas pública"</b>: demandas concluídas, ofícios atendidos e emendas indicadas, empenhadas ou pagas. Nome, telefone e endereço do cidadão nunca aparecem.</p>
      <div class="f"><label for="prest-link">Link da página</label><input id="prest-link" value="${esc(linkPrestacao())}" readonly></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><a class="btn mini wa" href="${esc('https://wa.me/?text=' + encodeURIComponent('Veja o que o mandato do ' + DEP() + ' já conquistou: ' + linkPrestacao()))}" target="_blank" rel="noopener">Enviar pelo WhatsApp</a><a class="btn mini ghost" href="${esc(linkPrestacao())}" target="_blank" rel="noopener">Ver página</a></div></section>
    <section class="panel"><h3>Formulário para o cidadão</h3>
      <p class="m" style="margin-top:0">Divulgue este link no WhatsApp, Instagram e site. Quem preencher cai direto em <b>Demandas</b>, como "Nova", com origem "Site do gabinete". A pessoa não vê nada do sistema.</p>
      <div class="f"><label for="pub-link">Link do formulário</label><input id="pub-link" value="${esc(linkPublico())}" readonly></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn mini" id="pub-copiar" type="button">Copiar link</button><a class="btn mini wa" href="${esc('https://wa.me/?text=' + encodeURIComponent('Precisa de ajuda do gabinete do ' + DEP() + '? Faça seu pedido aqui: ' + linkPublico()))}" target="_blank" rel="noopener">Enviar pelo WhatsApp</a><a class="btn mini ghost" href="${esc(linkPublico())}" target="_blank" rel="noopener">Ver formulário</a></div></section>` : ''}
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
  if (state.view === 'admin') setTimeout(async () => { const b = $('#modelos-box'); if (b) b.innerHTML = await modelosHtml(); carregarAdmin(); }, 0);
  main.innerHTML = state.view === 'painel' ? renderPainel() : state.view === 'agendas' ? renderAgendas() : state.view === 'etiquetas' ? renderEtiquetas() : state.view === 'conta' ? renderConta() : state.view === 'admin' ? renderAdmin() : state.view === 'graficos' ? renderGraficos() : state.view === 'relatorios' ? renderRelatorios() : state.view === 'importar' ? renderImportar() : state.view === 'mapa' ? renderMapa() : state.view === 'resumo-emendas' ? renderResumoEmendas() : state.view === 'cidadao' ? renderCidadao() : state.view === 'disparo' ? renderDisparo() : renderList(state.view);
  if (state.view === 'mapa') setTimeout(desenharMapa, 0); else mapaLib.destruir();
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
  if (f.type === 'bool') return `<label class="chk"><input type="checkbox" id="${id}" ${v === true ? 'checked' : ''} ${dis}> <span>${esc(f.l)}</span></label>`;
  if (f.type === 'textarea') return `<textarea id="${id}" ${dis}>${esc(v)}</textarea>`;
  if (f.type === 'money') return `<input id="${id}" inputmode="decimal" placeholder="0,00" value="${v !== '' && v != null ? esc(Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })) : ''}" ${dis}>`;
  const type = ['date', 'time', 'number', 'tel', 'email', 'url'].includes(f.type) ? f.type : 'text';
  if (type === 'tel') return `<input id="${id}" type="tel" inputmode="numeric" maxlength="20" placeholder="(45) 99999-9999" value="${esc(v)}" autocomplete="off" ${dis}>`;
  const list = f.orgaos ? 'list="dl-orgaos" placeholder="Escolha ou digite o órgão"' : f.list ? 'list="dl-munis"' : f.people ? 'list="dl-pessoas"' : f.team ? 'list="dl-equipe"' : '';
  return `<input id="${id}" type="${type}" value="${esc(f.type === 'time' ? hhmm(v) : v)}" ${list} ${f.mono ? 'style="font-family:var(--mono)"' : ''} autocomplete="off" ${dis}>`;
}

function openDrawer(mod, id, preset = {}) {
  const M = MODS[mod]; const rec = id ? data[mod].find(r => r.id === id) : null;
  if (id && !rec) return;
  if (geoMini) { geoMini.remover(); geoMini = null; }
  drawer.open = true; drawer.mod = mod; drawer.id = id;
  drawer.geo = rec && rec.lat != null && rec.lng != null ? [+rec.lat, +rec.lng] : (preset.lat != null ? [preset.lat, preset.lng] : null);
  const defaults = { status: M.statuses[0][0], ...(mod === 'agenda' ? { data: todayStr() } : {}), ...(mod === 'emendas' ? { exercicio: new Date().getFullYear() } : {}), ...(mod === 'proposituras' ? { ano: new Date().getFullYear() } : {}), ...(M.fields.some(f => f.k === 'responsavel') ? { responsavel: myName() } : {}), ...(mod === 'recepcao' ? { hora_chegada: pad(new Date().getHours()) + ':' + pad(new Date().getMinutes()) } : {}) };
  const r = rec || { ...defaults, ...preset };
  const fields = M.fields.map(f => f.type === 'bool' ? `<div class="f wide">${fieldInput(f, r[f.k] ?? false, false)}</div>` : `<div class="f ${f.wide ? 'wide' : ''}"><label for="f-${f.k}">${esc(f.l)}${f.req ? ' <span class="req">*</span>' : ''}</label>${fieldInput(f, r[f.k] ?? '', false)}</div>`).join('');
  const statusSel = `<div class="f"><label for="f-status">Situação</label><select id="f-status">${M.statuses.map(s => `<option ${s[0] === r.status ? 'selected' : ''}>${esc(s[0])}</option>`).join('')}</select></div>`;
  const hist = rec && rec.historico && rec.historico.length ? `<div class="hist"><span class="eyebrow">Histórico</span><ol>${rec.historico.slice().reverse().map(h => `<li><time>${fmtStamp(h.em)}</time><span>${esc(h.txt)}${h.por ? ' <span class="m">· ' + esc(h.por) + '</span>' : ''}</span></li>`).join('')}</ol></div>` : '';
  // ações rápidas
  const acts = [];
  if (rec && M.phone) { const wa = waLink(rec[M.phone], waTexto(mod, rec)); if (wa) acts.push(`<a class="btn wa mini" href="${esc(wa)}" target="_blank" rel="noopener">Abrir WhatsApp</a>`); }
  if (rec && mod === 'pessoas') {
    const linked = ['demandas', 'servicos', 'emendas'].reduce((n, m) => n + data[m].filter(x => [x.solicitante, x.beneficiario, x.quem_pediu].includes(rec.nome)).length, 0);
    acts.push(`<button class="btn mini primary" type="button" data-cid="${esc(rec.nome)}" data-cid-tel="${esc(rec.telefone || '')}">Histórico do cidadão</button>`);
    acts.push(`<button class="btn mini" type="button" data-new-for="demandas">+ Demanda desta pessoa</button>`);
    if (linked) acts.push(`<button class="btn mini" type="button" data-search="${esc(rec.nome)}">Ver ${linked} registro(s) ligado(s)</button>`);
  }
  if (rec && mod === 'agenda') acts.push(`<button class="btn mini wa" type="button" data-disp-convite>Convidar pessoas pelo WhatsApp</button>`);
  if (rec && mod === 'agenda' && rec.data) acts.push(`<a class="btn mini" href="${esc(ags.linkGoogleEvento(rec))}" target="_blank" rel="noopener">📅 Pôr no Google Agenda</a>`);
  if (rec && mod === 'recepcao') acts.push(`<button class="btn mini primary" type="button" data-recep-demanda>Transformar em demanda</button>`, `<button class="btn mini" type="button" data-cid="${esc(rec.nome)}" data-cid-tel="${esc(rec.telefone || '')}">Histórico de ${esc(primeiroNome(rec.nome))}</button>`);
  if (rec && mod === 'demandas') acts.push(`<button class="btn mini primary" type="button" data-oficio-de>Gerar ofício de solicitação</button>`);
  if (rec && ['demandas', 'servicos'].includes(mod) && rec.solicitante) acts.push(`<button class="btn mini" type="button" data-cid="${esc(rec.solicitante)}" data-cid-tel="${esc(rec.telefone || '')}">Histórico de ${esc(primeiroNome(rec.solicitante))}</button>`);
  if (rec && mod !== 'tarefas') acts.push(`<button class="btn mini" type="button" data-tarefa-de>+ Tarefa</button>`);
  if (rec && mod === 'demandas') data.servicos.filter(o => o.demanda_id === rec.id).forEach(o => acts.push(`<button class="btn mini ghost" type="button" data-open="servicos:${o.id}">📄 Ofício ${esc(o.protocolo || '(sem nº)')} · ${esc(o.status)}</button>`));
  if (rec && mod === 'servicos' && rec.demanda_id && data.demandas.some(d => d.id === rec.demanda_id)) acts.push(`<button class="btn mini ghost" type="button" data-open="demandas:${rec.demanda_id}">↩ Demanda de origem</button>`);
  const dt = rec && docTipo(mod, rec);
  if (dt) acts.push(`<button class="btn mini" type="button" id="btn-doc">Gerar ${docs.TIPOS[dt]} (Word)</button>`);
  if (rec && mod === 'proposituras' && rec.link) acts.push(`<a class="btn mini" href="${esc(rec.link)}" target="_blank" rel="noopener">Abrir tramitação</a>`);
  $('#overlay').innerHTML = `<div class="scrim" data-close></div><aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="dr-t">
    <div class="dr-head"><div style="min-width:0"><div class="eyebrow">${esc(M.label)}${rec && rec.protocolo ? ' · Protocolo ' + esc(rec.protocolo) : ''}</div><h3 id="dr-t">${rec ? esc(M.title(rec)) : esc(M.novo)}</h3></div><button class="btn ghost" data-close aria-label="Fechar">✕</button></div>
    <form class="dr-body" id="frm" novalidate>${acts.length ? `<div class="dr-actions">${acts.join('')}</div>` : ''}${statusSel}<div class="f"></div>${fields}
      <datalist id="dl-munis"></datalist><datalist id="dl-pessoas"></datalist><datalist id="dl-equipe"></datalist><datalist id="dl-orgaos">${AREAS_DEMANDA.map(o => `<option value="${esc(o)}">`).join('')}</datalist><div class="err" id="frm-err" hidden></div>
      ${M.geo ? `<div class="geo" id="geo"><span class="eyebrow">Localização exata</span>
        <div class="geo-busca"><input id="geo-end" placeholder="Rua, número, bairro" value="${esc(r.local || [r.bairro, r.municipio].filter(Boolean).join(', '))}" autocomplete="off"><button class="btn mini" type="button" id="geo-buscar">🔎 Buscar</button><button class="btn mini" type="button" id="geo-gps">📍 Estou no local</button></div>
        <div id="geo-map" class="geo-map"></div>
        <div class="geo-info" id="geo-info"></div></div>` : ''}
      ${store.anexosDisponiveis ? `<div class="anx" id="anx">${anexosHtml(rec)}</div>` : ''}${hist}
      ${rec ? `<div class="m" style="grid-column:1/-1">Cadastrado em ${fmtStamp(rec.criado_em)} · atualizado em ${fmtStamp(rec.atualizado_em)}</div>` : ''}</form>
    <div class="dr-foot"><div id="del-zone">${rec ? '<button class="btn danger" id="btn-del" type="button">Excluir</button>' : ''}</div><div class="r"><button class="btn" data-close type="button">Cancelar</button><button class="btn primary" id="btn-save" type="button">Salvar</button></div></div></aside>`;
  refreshDatalists();
  carregarMiniaturas();
  if (M.geo) iniciarGeo();
  // ao escolher uma pessoa cadastrada, preenche telefone e município
  ['solicitante', ...(mod === 'recepcao' ? ['nome'] : [])].forEach(k => { const el = $('#f-' + k); if (el) el.addEventListener('change', () => { const p = data.pessoas.find(x => x.nome === el.value); if (!p) return; [['telefone', 'telefone'], ['municipio', 'municipio'], ['bairro', 'bairro']].forEach(([a, b]) => { const t = $('#f-' + a); if (t && !t.value && p[b]) t.value = p[b]; }); }); });
  setTimeout(() => { const f = $('#f-' + M.fields[0].k); f && f.focus(); }, 30);
}
/* ---------- localização exata no registro ---------- */
const linkMaps = p => `https://www.google.com/maps/search/?api=1&query=${p[0].toFixed(6)},${p[1].toFixed(6)}`;
const linkWaze = p => `https://waze.com/ul?ll=${p[0].toFixed(6)},${p[1].toFixed(6)}&navigate=yes`;
function geoInfo() {
  const el = $('#geo-info'); if (!el) return; const p = drawer.geo;
  el.innerHTML = p ? `<span class="m">📍 ${p[0].toFixed(5)}, ${p[1].toFixed(5)} · arraste o alfinete para ajustar</span><span class="geo-links"><a class="btn mini" href="${linkMaps(p)}" target="_blank" rel="noopener">Google Maps</a><a class="btn mini" href="${linkWaze(p)}" target="_blank" rel="noopener">Waze</a><button class="btn mini ghost" type="button" id="geo-limpar">Tirar marcação</button></span>`
    : '<span class="m">Toque no mapa para marcar o ponto exato, busque o endereço ou use "Estou no local" (GPS do celular).</span>';
}
async function iniciarGeo() {
  const el = $('#geo-map'); if (!el) return; geoInfo();
  const alvo = drawer.id;
  try {
    const m = await mapaLib.miniMapa(el, drawer.geo, p => { drawer.geo = p; geoInfo(); });
    if (!drawer.open || drawer.id !== alvo || !document.body.contains(el)) { m.remover(); return; }
    geoMini = m;
  } catch (e) { el.innerHTML = '<div class="m" style="padding:10px">Mapa indisponível: ' + esc(errMsg(e)) + '</div>'; }
}
async function geoBuscar() {
  const t = ($('#geo-end')?.value || '').trim(); if (!t) { toast('Digite o endereço'); return; }
  const b = $('#geo-buscar'); b.disabled = true; b.textContent = 'Buscando…';
  try {
    const mun = $('#f-municipio')?.value || cfg.cidade_gabinete || '';
    const bairro = ($('#f-bairro')?.value || '').trim();
    const txt = bairro && !t.toLowerCase().includes(bairro.toLowerCase()) ? t + ', ' + bairro : t;
    const p = await mapaLib.buscarEndereco(txt, { mun, uf: UF_GAB() || 'PR' });
    if (!p) toast('Endereço não encontrado. Confira o nome da rua ou toque no mapa no local certo.');
    else { const aviso = p.aviso; drawer.geo = [p[0], p[1]]; geoMini?.marcar(drawer.geo, true); geoInfo(); if (aviso) toast(aviso); }
  } catch (e) { toast(errMsg(e)); }
  b.disabled = false; b.textContent = '🔎 Buscar';
}
function geoGps() {
  if (!navigator.geolocation) { toast('Este aparelho não tem localização'); return; }
  const b = $('#geo-gps'); b.disabled = true; b.textContent = 'Localizando…';
  navigator.geolocation.getCurrentPosition(pos => {
    const p = [pos.coords.latitude, pos.coords.longitude]; drawer.geo = p; geoMini?.marcar(p, true); geoInfo();
    b.disabled = false; b.textContent = '📍 Estou no local';
    if (pos.coords.accuracy > 100) toast('Localização aproximada (±' + Math.round(pos.coords.accuracy) + ' m). Arraste o alfinete se precisar.');
  }, err => { b.disabled = false; b.textContent = '📍 Estou no local'; toast(err.code === 1 ? 'Permita o acesso à localização no navegador' : 'Não consegui pegar a localização'); }, { enableHighAccuracy: true, timeout: 15000 });
}

function closeDrawer() { drawer.open = false; if (geoMini) { geoMini.remover(); geoMini = null; } $('#overlay').innerHTML = ''; }

function readForm(mod) {
  const rec = {};
  for (const f of MODS[mod].fields) {
    if (f.type === 'bool') { rec[f.k] = $('#f-' + f.k).checked; continue; }
    let v = $('#f-' + f.k).value.trim();
    if (f.type === 'money') v = parseMoney(v); else if (f.type === 'number') v = v ? parseInt(v, 10) : null; else if (v === '') v = null;
    rec[f.k] = v;
  }
  // só manda lat/lng se houver ponto marcado ou se o banco já tiver essas colunas
  if (MODS[mod].geo && drawer.mod === mod) { const old = drawer.id && data[mod].find(r => r.id === drawer.id); if (drawer.geo || (old && 'lat' in old)) { rec.lat = drawer.geo ? drawer.geo[0] : null; rec.lng = drawer.geo ? drawer.geo[1] : null; } }
  return rec;
}
async function saveDrawer() {
  const { mod, id } = drawer; const M = MODS[mod]; const old = id ? data[mod].find(r => r.id === id) : null;
  const rec = readForm(mod);
  const missing = M.fields.filter(f => f.req && (rec[f.k] == null || rec[f.k] === '')).map(f => f.l);
  if (missing.length) { const e = $('#frm-err'); e.hidden = false; e.textContent = 'Preencha: ' + missing.join(', ') + '.'; return; }
  // trava de telefone: confere só o que foi digitado ou mudado (cadastros antigos continuam salvando)
  const telRuim = M.fields.filter(f => f.type === 'tel' && rec[f.k] && digitosTel(rec[f.k]) !== digitosTel(old?.[f.k]) && !telefoneOk(rec[f.k]));
  if (telRuim.length) { const e = $('#frm-err'); e.hidden = false; e.textContent = 'Telefone inválido. Digite com DDD: (45) 99999-9999 para celular ou (45) 3333-4444 para fixo.'; const i = $('#f-' + telRuim[0].k); if (i) i.focus(); return; }
  M.fields.filter(f => f.type === 'tel' && rec[f.k] && telefoneOk(rec[f.k])).forEach(f => { rec[f.k] = mascaraTel(rec[f.k]); });
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
    if (!old && mod === 'demandas') cadastrarQuemPediu([row]).catch(() => {});
    if (old && old.status !== st && M.phone && row[M.phone] && ['demandas', 'servicos'].includes(mod)) {
      const wa = waLink(row[M.phone], waStatus(mod, row));
      if (wa) setTimeout(() => toastAcao('Avisar ' + (primeiroNome(row.solicitante) || 'o cidadão') + ' da nova situação?', wa, 'Avisar no WhatsApp'), 400);
    }
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

/* ---------- ofício a partir da demanda ---------- */
const ORGAO_POR_AREA = {
  'Obras': 'Secretaria Municipal de Obras Públicas', 'Infraestrutura': 'Secretaria Municipal de Obras Públicas', 'Iluminação pública': 'Secretaria Municipal de Obras Públicas',
  'Trânsito': 'Autarquia Municipal de Mobilidade, Trânsito e Cidadania - TRANSITAR', 'Meio ambiente': 'Secretaria Municipal de Meio-Ambiente',
  'Saúde': 'Secretaria Municipal de Saúde', 'Educação': 'Secretaria Municipal de Educação', 'Assistência social': 'Secretaria Municipal de Assistência Social',
  'Segurança': 'Secretaria Municipal de Segurança Pública e Proteção à Comunidade', 'Emprego e renda': 'Secretaria Municipal de Desenvolvimento Econômico', 'Esporte e cultura': 'Secretaria Municipal de Esporte e Lazer',
};
async function oficioDaDemanda() {
  const { id } = drawer; let d = data.demandas.find(x => x.id === id); if (!d) return;
  const btn = $('[data-oficio-de]'); if (btn) { btn.disabled = true; btn.textContent = 'Criando ofício…'; }
  try {
    // grava antes o que foi digitado na demanda
    const form = readForm('demandas'); const st = $('#f-status').value;
    if (Object.keys(form).some(k => String(form[k] ?? '') !== String(d[k] ?? '')) || st !== d.status) { d = await store.saveRow('demandas', d.id, { ...form, status: st }); upsertLocal('demandas', d); }
    const agora = new Date().toISOString(), por = myName();
    const linhas = [`Solicito a Vossa Senhoria ${d.assunto ? d.assunto.charAt(0).toLowerCase() + d.assunto.slice(1) : 'providências'}${d.bairro ? ', no bairro ' + d.bairro : ''}${d.municipio ? ', no município de ' + d.municipio : ''}.`];
    if (d.descricao) linhas.push(d.descricao.replace(/\s*\n+\s*/g, ' '));
    if (d.lat != null) linhas.push('Localização exata: ' + linkMaps([+d.lat, +d.lng]));
    linhas.push(`A solicitação atende à demanda encaminhada a este gabinete por ${d.solicitante || 'munícipe'}, que aguarda providências.`);
    linhas.push('Solicito, ainda, retorno a este gabinete sobre as providências adotadas e a previsão de atendimento.');
    const of = {
      servico: d.assunto, solicitante: d.solicitante, telefone: d.telefone, municipio: d.municipio, local: d.bairro,
      orgao: (AREAS_DEMANDA.includes(d.area) ? d.area : ORGAO_POR_AREA[d.area]) || null, tipo_doc: 'Ofício', prazo: addDays(todayStr(), 15), responsavel: por || d.responsavel,
      corpo: linhas.join('\n'), status: 'Recebida', demanda_id: d.id,
      ...(d.lat != null ? { lat: d.lat, lng: d.lng } : {}),
      historico: [{ em: agora, txt: 'Criado a partir da demanda “' + d.assunto + '”', por }],
    };
    let row;
    try { row = await store.saveRow('servicos', null, of); }
    catch (e) { if (!/demanda_id|lat|lng/.test(errMsg(e))) throw e; delete of.demanda_id; delete of.lat; delete of.lng; of.obs = 'Demanda de origem: ' + d.assunto; row = await store.saveRow('servicos', null, of); }
    upsertLocal('servicos', row);
    const hist = (d.historico || []).concat({ em: agora, txt: 'Ofício de solicitação criado' + (of.orgao ? ' para ' + of.orgao : ''), por });
    d = await store.saveRow('demandas', d.id, { historico: hist.slice(-100), status: d.status === 'Nova' ? 'Encaminhada' : d.status }); upsertLocal('demandas', d);
    closeDrawer(); go('servicos'); openDrawer('servicos', row.id);
    toast('Ofício criado. Confira o órgão e o texto e toque em "Gerar Ofício (Word)".');
  } catch (e) { toast('Não foi possível criar o ofício: ' + errMsg(e)); if (btn) { btn.disabled = false; btn.textContent = 'Gerar ofício de solicitação'; } }
}

/* ---------- documentos Word ---------- */
/** Linhas do destinatário no topo do ofício. Sem nome de destinatário, o ofício vai ao órgão: "À Secretaria Municipal de Obras Públicas" / "Cascavel – PR". */
function blocoDestinatario(r, tipo) {
  const orgao = (r.orgao || '').trim(), dest = (r.destinatario || '').trim();
  if (tipo !== 'oficio' || dest || !orgao) return { destinatario: dest, orgao };
  const fem = /^(secretaria|procuradoria|controladoria|ag[êe]ncia|companhia|c[âa]mara|prefeitura|coordenadoria|diretoria|funda[çc][ãa]o|autarquia|superintend[êe]ncia|guarda|defesa|ouvidoria|assessoria)\b/i.test(orgao);
  const cidade = (r.municipio || cfg.cidade_gabinete || '').trim();
  const uf = UF_GAB() || 'PR';
  return { destinatario: (fem ? 'À ' : 'Ao ') + orgao, orgao: cidade ? cidade + (uf && !cidade.includes(uf) ? ' – ' + uf : '') : '' };
}
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
    // órgão destinatário: o do ofício ou, se vazio, o da demanda de origem
    if (mod === 'servicos' && !r.orgao && r.demanda_id) {
      const dem = data.demandas.find(x => x.id === r.demanda_id);
      const org = dem && ((AREAS_DEMANDA.includes(dem.area) ? dem.area : ORGAO_POR_AREA[dem.area]) || '');
      if (org) { r = await store.saveRow(mod, r.id, { orgao: org }); upsertLocal(mod, r); }
    }
    if (tipo === 'oficio' && !r.orgao && !r.destinatario) throw new Error('Escolha o "Órgão destinatário" do ofício antes de gerar o Word.');
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
    // fotos e mapa do local vão numa página de anexo no fim do documento
    if (btn) btn.textContent = 'Juntando fotos e mapa…';
    const anexoImgs = await imagensDoDocumento(mod, r);
    if (anexoImgs.length) {
      const tem = anexoImgs.some(x => x.mapa) ? (anexoImgs.length > 1 ? 'registro fotográfico e mapa com a localização do local' : 'mapa com a localização do local') : 'registro fotográfico do local';
      const aviso = `Segue, em anexo, ${tem}.`;
      if (tipo === 'oficio') { const i = Math.max(0, paragrafos.length - 1); paragrafos.splice(i, 0, aviso); } else justificativa.push(aviso);
    }
    if (btn) btn.textContent = 'Gerando…';
    const [cargo1, partido] = String(cfg.deputado_cargo || '').split('/');
    const valores = {
      ...cfg, numero, ano: anoDoc, data_extenso: docs.dataExtenso(), ...blocoDestinatario(r, tipo),
      destinatario_orgao: [r.destinatario, r.orgao].filter(Boolean).join(', ') || 'órgão competente', municipio_uf: munUf, assunto, local_texto: localTxt, texto, paragrafos, justificativa,
      numero_doc: tipo === 'oficio' ? numero : (numero ? String(numero).split('/')[0] : ''),
      vocativo: r.vocativo || (!r.destinatario && /^secretaria/i.test(r.orgao || '') ? 'Senhor(a) Secretário(a)' : 'Senhor(a)'), solicitante: r.solicitante || '',
      gabinete_maiusculo: (cfg.gabinete || '').toLocaleUpperCase('pt-BR'),
      proponente: [cargo1 && cargo1.trim(), cfg.deputado_nome].filter(Boolean).join(' ') + (partido ? '/' + partido.trim() : ''),
    };
    let blob = await docs.gerarDocx(tipo, valores);
    if (anexoImgs.length) { try { blob = await docs.anexarImagens(blob, 'ANEXO – ' + (anexoImgs.some(x => x.mapa) ? (anexoImgs.length > 1 ? 'LOCALIZAÇÃO E REGISTRO FOTOGRÁFICO' : 'LOCALIZAÇÃO') : 'REGISTRO FOTOGRÁFICO'), anexoImgs); } catch (e) { console.warn(e); toast('Documento gerado sem as fotos (não foi possível juntá-las).'); } }
    docs.baixar(blob, `${docs.TIPOS[tipo]}${numero ? '-' + String(numero).replace(/\//g, '-') : ''}-${anoDoc}.docx`.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
    const rot = numero ? `${docs.TIPOS[tipo]} nº ${numero}${tipo === 'oficio' ? '/' + anoDoc : ''}` : docs.TIPOS[tipo];
    const hist = (r.historico || []).concat({ em: new Date().toISOString(), txt: `${rot} gerado em Word`, por: myName() }).slice(-100);
    const extra = {};
    if (store.anexosDisponiveis) {
      try {
        const nomeArq = `${docs.TIPOS[tipo]}${numero ? '-' + String(numero).replace(/\//g, '-') : ''}-${anoDoc}.docx`.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const path = `${mod}/${r.id}/${Date.now()}-${nomeSeguro(nomeArq)}`;
        await store.enviarAnexo(path, new File([blob], nomeArq, { type: blob.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
        extra.anexos = (r.anexos || []).concat({ path, nome: nomeArq, tamanho: blob.size, em: new Date().toISOString(), por: myName() });
      } catch { /* sem a pasta de anexos, segue só com o download */ }
    }
    r = await store.saveRow(mod, r.id, { historico: hist, ...extra }); upsertLocal(mod, r);
    toast(`${rot} gerado`);
    openDrawer(mod, r.id);
  } catch (e) { toast(errMsg(e)); if (btn) { btn.disabled = false; btn.textContent = 'Gerar ' + docs.TIPOS[tipo] + ' (Word)'; } }
}

/** Mapa do ponto marcado e fotos do registro (e da demanda de origem), prontos para o Word. */
async function imagensDoDocumento(mod, r) {
  const origem = mod === 'servicos' && r.demanda_id ? data.demandas.find(d => d.id === r.demanda_id) : null;
  const out = [];
  const lat = r.lat ?? origem?.lat, lng = r.lng ?? origem?.lng;
  const endereco = [r.local || origem?.bairro, r.municipio || origem?.municipio].filter(Boolean).join(', ');
  if (lat != null && lng != null && lat !== '' && lng !== '') {
    try { const m = await docs.imagemMapa(+lat, +lng); out.push({ ...m, mapa: true, legenda: `Localização${endereco ? ': ' + endereco : ''} (${(+lat).toFixed(6)}, ${(+lng).toFixed(6)}). Ver no Google Maps: ${linkMaps([+lat, +lng])}` }); }
    catch (e) { console.warn('mapa', e); }
  }
  const fotos = [...(r.anexos || []), ...(origem?.anexos || [])].filter(a => tipoMidia(a) === 'foto').filter((a, i, l) => l.findIndex(b => b.path === a.path) === i).slice(0, 8);
  if (fotos.length) {
    let links = {}; try { links = await store.linksAnexos(fotos.map(f => f.path)); } catch { /* sem fotos */ }
    let n = 0;
    for (const f of fotos) {
      if (!links[f.path]) continue;
      try { const img = await docs.imagemParaWord(links[f.path]); n++; out.push({ ...img, legenda: `Foto ${n}${f.em ? ' – ' + fmtDate(String(f.em).slice(0, 10)) : ''}` }); } catch (e) { console.warn('foto', e); }
    }
  }
  return out;
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

/* ---------- lista de contatos: quem fez pedidos ---------- */
// mesma pessoa = mesmo celular (8 últimos dígitos) ou mesmo nome
function chavesPessoa(nome, tel) { const k = []; const d = dig8(tel); if (d.length === 8) k.push('t' + d); const n = normNome(nome); if (n) k.push('n' + n); return k; }
function contagemPedidos() {
  const idx = new Map(); data.pessoas.forEach(p => chavesPessoa(p.nome, p.telefone).forEach(k => { if (!idx.has(k)) idx.set(k, p.id); }));
  const c = new Map();
  data.demandas.forEach(r => { const id = chavesPessoa(r.solicitante, r.telefone).map(k => idx.get(k)).find(Boolean); if (id) c.set(id, (c.get(id) || 0) + 1); });
  return c;
}
function quemPediuSemCadastro(fonte) {
  const ja = new Set(); data.pessoas.forEach(p => chavesPessoa(p.nome, p.telefone).forEach(k => ja.add(k)));
  const out = []; const visto = new Map();
  const add = (nome, tel, bairro, municipio, quando, origem) => {
    nome = String(nome || '').trim(); if (!nome && !tel) return;
    const ks = chavesPessoa(nome, tel); if (!ks.length || ks.some(k => ja.has(k))) return;
    const prev = ks.map(k => visto.get(k)).find(Boolean);
    if (prev) { prev.n++; if (!prev.telefone && tel) prev.telefone = tel; if (!prev.bairro && bairro) prev.bairro = bairro; if (!prev.municipio && municipio) prev.municipio = municipio; if (quando > prev.ultimo) prev.ultimo = quando; ks.forEach(k => visto.set(k, prev)); return; }
    const o = { nome: nome || 'Sem nome', telefone: tel || '', bairro: bairro || '', municipio: municipio || '', n: 1, ultimo: quando || '', origem };
    out.push(o); ks.forEach(k => visto.set(k, o));
  };
  const lista = fonte || data.demandas;
  lista.slice().sort((a, b) => String(b.criado_em || '').localeCompare(String(a.criado_em || ''))).forEach(r => add(r.solicitante, r.telefone, r.bairro, r.municipio, r.criado_em, 'demanda'));
  if (!fonte) data.recepcao.forEach(r => add(r.nome, r.telefone, r.bairro, '', r.criado_em, 'recepção'));
  return out;
}
async function cadastrarQuemPediu(fonte) {
  const novos = quemPediuSemCadastro(fonte); if (!novos.length) return 0;
  const now = new Date().toISOString(); const por = myName();
  const regs = novos.map(o => ({ nome: o.nome, telefone: o.telefone || null, bairro: o.bairro || null, municipio: o.municipio || null, tipo: 'Eleitor(a)', grupo: 'Fez pedido', status: 'Ativo',
    obs: 'Colocado na lista automaticamente (' + (o.origem === 'recepção' ? 'visitou o gabinete' : o.n + (o.n > 1 ? ' pedidos' : ' pedido')) + ').',
    historico: [{ em: now, txt: 'Cadastrado a partir dos pedidos', por }] }));
  const rows = await store.insertMany('pessoas', regs);
  rows.forEach(r => { if (!data.pessoas.some(x => x.id === r.id)) data.pessoas.unshift(r); });
  return rows.length;
}
// arquivo .vcf: abre no celular (Android/iPhone) ou importa no Google Contatos
function exportVcf() {
  const lista = filtered('pessoas').filter(p => p.telefone);
  if (!lista.length) { toast('Nenhuma pessoa com telefone nesta lista'); return; }
  const e = v => String(v || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);
  const fone = t => { let d = String(t).replace(/\D/g, ''); if (d.length === 10 || d.length === 11) d = '55' + d; return '+' + d; };
  const txt = lista.map(p => ['BEGIN:VCARD', 'VERSION:3.0', 'FN:' + e(p.nome), 'N:' + e(p.nome) + ';;;;', 'TEL;TYPE=CELL:' + fone(p.telefone)]
    .concat(p.email ? ['EMAIL:' + e(p.email)] : [])
    .concat(p.endereco || p.bairro || p.municipio ? ['ADR;TYPE=HOME:;;' + e(p.endereco) + ';' + e([p.bairro, p.municipio].filter(Boolean).join(' - ')) + ';' + e(p.uf) + ';' + e(p.cep) + ';Brasil'] : [])
    .concat(p.nascimento ? ['BDAY:' + p.nascimento] : [])
    .concat(p.tipo || p.grupo ? ['NOTE:' + e([p.tipo, p.grupo].filter(Boolean).join(' · '))] : []).concat(['ORG:' + e(NOME_GAB()), 'END:VCARD']).join('\r\n')).join('\r\n') + '\r\n';
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/vcard;charset=utf-8' }));
  a.download = 'contatos-' + todayStr() + '.vcf'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  toast(lista.length + ' contato(s) salvos no arquivo');
}

/* ---------- cópia de segurança ---------- */
const diasDesde = iso => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 864e5) : Infinity;
const backupAtrasado = () => store.configured && state.loaded && ORDER.some(m => data[m].length) && diasDesde(state.backup?.em) >= 7;
async function baixarBackup(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Gerando…'; }
  try {
    const { default: writeExcelFile } = await import('write-excel-file/browser');
    const txt = v => v == null ? null : typeof v === 'number' ? v : String(v);
    const abas = ORDER.map(m => {
      const M = MODS[m];
      const cab = ['Situação', ...M.fields.map(f => f.l), 'Cadastrado em', 'Atualizado em', 'Anexos', 'Histórico'].map(h => ({ value: h, fontWeight: 'bold' }));
      const linhas = data[m].map(r => [txt(r.status), ...M.fields.map(f => txt(r[f.k])), fmtStamp(r.criado_em), fmtStamp(r.atualizado_em), (r.anexos || []).map(a => a.nome).join(', ') || null, (r.historico || []).map(h => fmtStamp(h.em) + ' ' + h.txt + (h.por ? ' (' + h.por + ')' : '')).join(' | ') || null]);
      return { data: [cab, ...linhas], sheet: M.label.slice(0, 31), stickyRowsCount: 1 };
    });
    await writeExcelFile(abas).toFile(`copia-gabinete-${todayStr()}.xlsx`);
    const reg = { em: new Date().toISOString(), por: myName() };
    state.backup = reg; try { await store.setConfig('backup', reg); } catch { /* ok */ }
    toast('Cópia de segurança baixada'); render();
  } catch (e) { toast('Não foi possível gerar a cópia: ' + errMsg(e)); if (btn) { btn.disabled = false; btn.textContent = 'Baixar cópia completa (Excel)'; } }
}

/* ---------- avisos (lembretes) ---------- */
function avisos() {
  const t = todayStr(), am = addDays(t, 1), md = t.slice(5);
  const itens = [];
  ['demandas', 'servicos'].forEach(m => data[m].forEach(r => {
    if (!isOpen(m, r) || !r.prazo) return;
    if (r.prazo < t) itens.push({ m, r, nivel: 'late', txt: 'Prazo vencido em ' + fmtDate(r.prazo), urg: 1 });
    else if (r.prazo <= am) itens.push({ m, r, nivel: 'and', txt: r.prazo === t ? 'Prazo vence hoje' : 'Prazo vence amanhã', urg: 1 });
  }));
  data.tarefas.forEach(r => { if (isOpen('tarefas', r) && r.prazo && r.prazo <= t && (!r.responsavel || r.responsavel === myName())) itens.push({ m: 'tarefas', r, nivel: r.prazo < t ? 'late' : 'and', txt: r.prazo < t ? 'Tarefa atrasada desde ' + fmtDate(r.prazo) : 'Tarefa para hoje', urg: 1 }); });
  data.demandas.forEach(r => { if (r.status === 'Nova' && r.origem === 'Site do gabinete') itens.push({ m: 'demandas', r, nivel: 'novo', txt: 'Pedido novo pelo site', urg: 1 }); });
  data.agenda.forEach(r => { if (r.data === t && r.status !== 'Cancelado') itens.push({ m: 'agenda', r, nivel: 'and', txt: 'Hoje ' + (hhmm(r.inicio) || ''), urg: 0 }); });
  data.pessoas.forEach(r => { if (r.nascimento && r.status !== 'Inativo' && r.nascimento.slice(5) === md) itens.push({ m: 'pessoas', r, nivel: 'ok', txt: 'Faz aniversário hoje', urg: 1, wa: waLink(r.telefone, waAniversario(r)) }); });
  const ordem = { late: 0, novo: 1, and: 2, ok: 3 };
  itens.sort((a, b) => ordem[a.nivel] - ordem[b.nivel]);
  return { itens, urgentes: itens.filter(i => i.urg).length + (backupAtrasado() ? 1 : 0) };
}
function abrirAvisos() {
  const { itens } = avisos();
  const titulo = i => i.m === 'pessoas' ? i.r.nome : MODS[i.m].title(i.r);
  const podeNotif = 'Notification' in window && Notification.permission === 'default';
  drawer.open = true; drawer.mod = null; drawer.id = null;
  $('#overlay').innerHTML = `<div class="scrim" data-close></div><aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="av-t">
    <div class="dr-head"><div><div class="eyebrow">Lembretes de hoje</div><h3 id="av-t">Avisos</h3></div><button class="btn ghost" data-close aria-label="Fechar">✕</button></div>
    <div class="dr-body" style="display:block">
      ${podeNotif ? '<div class="dr-actions" style="margin-bottom:12px"><button class="btn mini" id="av-notif" type="button">Receber estes avisos no computador</button></div>' : ''}
      ${backupAtrasado() ? `<div class="ag-item" style="cursor:default"><div class="ag-when"><b>Cópia</b></div><div style="min-width:0"><div class="t">Fazer cópia de segurança</div><div class="m">${state.backup?.em ? 'A última foi há ' + diasDesde(state.backup.em) + ' dias' : 'Ainda não foi feita nenhuma'}. Guarde o arquivo no Google Drive ou no e-mail.</div></div><button class="btn mini primary" type="button" data-backup>Baixar</button></div>` : ''}
      ${itens.length ? itens.map(i => `<div class="ag-item" data-open="${i.m}:${i.r.id}"><div class="ag-when"><b>${esc(MODS[i.m].sing || MODS[i.m].label)}</b></div><div style="min-width:0"><div class="t">${esc(titulo(i))}</div><div class="m">${esc(i.txt)}</div></div>${i.wa ? `<a class="btn wa mini" href="${esc(i.wa)}" target="_blank" rel="noopener" data-stop>Parabenizar</a>` : `<span class="pill k-${i.nivel}">${i.nivel === 'late' ? 'Vencido' : i.nivel === 'novo' ? 'Novo' : 'Hoje'}</span>`}</div>`).join('')
        : backupAtrasado() ? '' : '<div class="empty"><b>Nenhum aviso hoje</b>Prazos vencendo, pedidos do site, compromissos e aniversários do dia aparecem aqui.</div>'}
    </div></aside>`;
}
function notificarNoComputador() {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const chave = 'gabinete-aviso-dia', hoje = todayStr();
    if (localStorage.getItem(chave) === hoje) return;
    const { itens, urgentes } = avisos(); if (!urgentes) return;
    const venc = itens.filter(i => i.nivel === 'late').length, site = itens.filter(i => i.nivel === 'novo').length, aniv = itens.filter(i => i.m === 'pessoas').length;
    const partes = [venc && venc + ' prazo(s) vencido(s)', site && site + ' pedido(s) novo(s) pelo site', aniv && aniv + ' aniversariante(s) hoje'].filter(Boolean);
    new Notification(NOME_GAB(), { body: partes.join(' · ') || urgentes + ' aviso(s) para hoje' });
    localStorage.setItem(chave, hoje);
  } catch { /* navegador sem suporte */ }
}

/* ---------- anexos ---------- */
const tamanho = n => n > 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
function anexosHtml(rec) {
  if (!rec) return '<span class="eyebrow">Anexos</span><div class="m">Salve o registro primeiro para anexar fotos, PDFs e documentos.</div>';
  const a = rec.anexos || [];
  const midias = a.map((x, i) => [x, i]).filter(([x]) => tipoMidia(x));
  return `<span class="eyebrow">Anexos${midias.length ? ' · ' + midias.length + ' foto(s)/vídeo(s)' : ''}</span>
    ${midias.length ? `<div class="anx-grid">${midias.map(([x, i]) => `<button type="button" class="anx-thumb" data-anx-ver="${i}" title="${esc(x.nome)}">${tipoMidia(x) === 'video' ? `<video data-path="${esc(x.path)}" muted playsinline preload="metadata"></video><span class="play">▶</span>` : `<img data-path="${esc(x.path)}" alt="${esc(x.nome)}" loading="lazy">`}</button>`).join('')}</div>` : ''}
    ${a.length ? `<ul class="anx-list">${a.map((x, i) => `<li><button class="linkbtn" type="button" ${tipoMidia(x) ? `data-anx-ver="${i}"` : `data-anx-abrir="${i}"`}>${tipoMidia(x) === 'video' ? '🎬' : tipoMidia(x) === 'foto' ? '🖼️' : '📎'} ${esc(x.nome)}</button><span class="m">${tamanho(x.tamanho || 0)} · ${fmtStamp(x.em)}${x.por ? ' · ' + esc(x.por) : ''}</span><button class="btn mini ghost" type="button" data-anx-del="${i}">Remover</button></li>`).join('')}</ul>` : '<div class="m">Nenhum arquivo anexado.</div>'}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
      <label class="btn mini" style="cursor:pointer">📷 Foto ou vídeo<input type="file" multiple accept="image/*,video/*" data-anx-add hidden></label>
      <label class="btn mini" style="cursor:pointer">+ Outro arquivo<input type="file" multiple data-anx-add hidden></label>
    </div>
    <div class="m" style="font-size:11.5px;margin-top:4px">Até 50 MB por arquivo (cerca de 1 minuto de vídeo do celular). Fotos grandes são reduzidas automaticamente.</div>`;
}
const tipoMidia = x => { const n = String(x.nome || x.path || '').toLowerCase(); const t = String(x.tipo || ''); if (t.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/.test(n)) return /\.(heic|heif)$/.test(n) ? 'foto-heic' : 'foto'; if (t.startsWith('video/') || /\.(mp4|mov|m4v|webm|3gp|avi|mkv)$/.test(n)) return 'video'; return ''; };
/** Preenche miniaturas de fotos e vídeos com links temporários. */
let linksCache = {};
async function carregarMiniaturas() {
  const els = [...document.querySelectorAll('#anx [data-path]')]; if (!els.length) return;
  const faltam = [...new Set(els.map(e => e.dataset.path))].filter(p => !linksCache[p] || linksCache[p].ate < Date.now());
  if (faltam.length) { try { const l = await store.linksAnexos(faltam); for (const [p, u] of Object.entries(l)) linksCache[p] = { u, ate: Date.now() + 50 * 60e3 }; } catch { return; } }
  els.forEach(e => { const c = linksCache[e.dataset.path]; if (c) e.src = c.u + (e.tagName === 'VIDEO' ? '#t=0.5' : ''); });
}
async function verMidia(i) {
  const r = data[drawer.mod].find(x => x.id === drawer.id); const a = r?.anexos || [];
  const lista = a.map((x, j) => [x, j]).filter(([x]) => tipoMidia(x)); let pos = lista.findIndex(([, j]) => j === i); if (pos < 0) return;
  const lb = document.createElement('div'); lb.className = 'lightbox'; lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true');
  document.body.appendChild(lb);
  const fechar = () => { lb.remove(); document.removeEventListener('keydown', tecla, true); };
  const tecla = e => { if (e.key === 'Escape') { e.stopPropagation(); fechar(); } else if (e.key === 'ArrowRight') mostrar(pos + 1); else if (e.key === 'ArrowLeft') mostrar(pos - 1); };
  document.addEventListener('keydown', tecla, true);
  async function mostrar(p) {
    pos = (p + lista.length) % lista.length; const [x] = lista[pos];
    lb.innerHTML = `<div class="lb-top"><span>${esc(x.nome)} <span class="m">${pos + 1} de ${lista.length}</span></span><span style="display:flex;gap:6px"><button class="btn mini" data-lb="baixar">Baixar</button><button class="btn mini" data-lb="fechar" aria-label="Fechar">✕</button></span></div><div class="lb-body"><div class="m">Carregando…</div></div>${lista.length > 1 ? '<button class="lb-nav l" data-lb="ant" aria-label="Anterior">‹</button><button class="lb-nav r" data-lb="prox" aria-label="Próximo">›</button>' : ''}`;
    try {
      let c = linksCache[x.path]; if (!c || c.ate < Date.now()) { const u = await store.linkAnexo(x.path); c = linksCache[x.path] = { u, ate: Date.now() + 4 * 60e3 }; }
      const body = lb.querySelector('.lb-body');
      body.innerHTML = tipoMidia(x) === 'video' ? `<video src="${esc(c.u)}" controls autoplay playsinline></video>` : tipoMidia(x) === 'foto-heic' ? `<div class="m" style="color:#fff">Foto no formato do iPhone (HEIC): toque em Baixar para abrir.</div>` : `<img src="${esc(c.u)}" alt="${esc(x.nome)}">`;
    } catch (err) { lb.querySelector('.lb-body').innerHTML = `<div class="m" style="color:#fff">${esc(errMsg(err))}</div>`; }
  }
  lb.addEventListener('click', e => {
    const b = e.target.closest('[data-lb]'); const k = b?.dataset.lb;
    if (k === 'fechar' || e.target === lb || e.target.classList.contains('lb-body')) fechar();
    else if (k === 'prox') mostrar(pos + 1); else if (k === 'ant') mostrar(pos - 1);
    else if (k === 'baixar') { const [x] = lista[pos]; store.linkAnexo(x.path, x.nome).then(u => { location.href = u; }).catch(err => toast(errMsg(err))); }
  });
  mostrar(pos);
}
/** Reduz fotos grandes (lado maior 2000 px, JPEG) para economizar espaço. */
async function reduzirFoto(f) {
  if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size < 1.5 * 1048576) return f;
  try {
    const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    if (!blob || blob.size >= f.size) return f;
    return new File([blob], f.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch { return f; }
}
const nomeSeguro = n => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '-').slice(-80);
async function anexarArquivos(mod, id, files) {
  let r = data[mod].find(x => x.id === id); if (!r) return;
  const novos = [];
  const box0 = $('#anx'); const aviso = document.createElement('div'); aviso.className = 'm anx-prog'; if (box0) box0.appendChild(aviso);
  for (let k = 0; k < files.length; k++) {
    let f = files[k];
    f = await reduzirFoto(f);
    if (f.size > 50 * 1048576) { toast(f.name + ' passa de 50 MB. Grave um vídeo mais curto ou envie pelo Google Drive e cole o link nas observações.'); continue; }
    aviso.textContent = `Enviando ${files.length > 1 ? (k + 1) + ' de ' + files.length + ': ' : ''}${f.name} (${tamanho(f.size)})… ${f.size > 8 * 1048576 ? 'vídeos podem levar um minuto.' : ''}`;
    const path = `${mod}/${id}/${Date.now()}-${nomeSeguro(f.name)}`;
    await store.enviarAnexo(path, f);
    novos.push({ path, nome: f.name, tamanho: f.size, tipo: f.type || '', em: new Date().toISOString(), por: myName() });
  }
  aviso.remove();
  if (!novos.length) return;
  r = data[mod].find(x => x.id === id);
  const hist = (r.historico || []).concat(novos.map(n => ({ em: n.em, txt: 'Anexo incluído: ' + n.nome, por: n.por }))).slice(-100);
  const row = await store.saveRow(mod, id, { anexos: (r.anexos || []).concat(novos), historico: hist });
  upsertLocal(mod, row);
  const box = $('#anx'); if (box && drawer.id === id) { box.innerHTML = anexosHtml(row); carregarMiniaturas(); }
  toast(novos.length === 1 ? 'Arquivo anexado' : novos.length + ' arquivos anexados');
}
async function removerAnexo(mod, id, i) {
  const r = data[mod].find(x => x.id === id); const a = (r?.anexos || []).slice(); const x = a[i]; if (!x) return;
  try { await store.apagarAnexo(x.path); } catch { /* se o arquivo já não existir, segue */ }
  a.splice(i, 1);
  const hist = (r.historico || []).concat({ em: new Date().toISOString(), txt: 'Anexo removido: ' + x.nome, por: myName() }).slice(-100);
  const row = await store.saveRow(mod, id, { anexos: a, historico: hist });
  upsertLocal(mod, row);
  const box = $('#anx'); if (box && drawer.id === id) { box.innerHTML = anexosHtml(row); carregarMiniaturas(); }
  toast('Anexo removido');
}

/* ---------- relatórios (para imprimir ou salvar em PDF) ---------- */
const DATA_REL = { demandas: r => r.criado_em, servicos: r => r.data_envio || r.criado_em, emendas: r => r.criado_em, proposituras: r => r.data_protocolo || r.criado_em, agenda: r => r.data, tarefas: r => r.prazo || r.criado_em, recepcao: r => r.criado_em, pessoas: r => r.criado_em };
function relFiltrados() {
  const f = state.rel, m = f.mod;
  return data[m].filter(r => {
    const d = String(DATA_REL[m](r) || '').slice(0, 10);
    return (!f.de || d >= f.de) && (!f.ate || d <= f.ate) && (!f.municipio || r.municipio === f.municipio) && (!f.bairro || r.bairro === f.bairro) && (!f.status || r.status === f.status);
  }).sort((a, b) => String(DATA_REL[m](a) || '').localeCompare(String(DATA_REL[m](b) || '')));
}
function renderRelatorios() {
  const f = state.rel, m = f.mod, M = MODS[m];
  const uniq = k => [...new Set(data[m].map(r => r[k]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
  const sel = (id, label, opts, v, todos = 'Todos') => `<div class="f"><label for="rl-${id}">${label}</label><select id="rl-${id}" data-rel="${id}">${todos ? `<option value="">${todos}</option>` : ''}${opts.map(o => { const [val, txt] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(txt)}</option>`; }).join('')}</select></div>`;
  const rows = relFiltrados();
  const conta = (k, vazio) => { const c = {}; rows.forEach(r => { const v = r[k] || vazio; c[v] = (c[v] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1]); };
  const tabela = (titulo, pares, max = 15) => pares.length ? `<section class="panel rel-box"><h3>${titulo}</h3><table class="rtab"><tbody>${pares.slice(0, max).map(([k, n]) => `<tr><td>${esc(k)}</td><td class="num">${n}</td><td class="num m">${Math.round(n / rows.length * 100)}%</td></tr>`).join('')}${pares.length > max ? `<tr><td class="m">Outros (${pares.length - max})</td><td class="num">${pares.slice(max).reduce((s, x) => s + x[1], 0)}</td><td></td></tr>` : ''}</tbody></table></section>` : '';
  const val = r => +(r.valor_indicado || r.valor_pedido) || 0;
  const periodo = f.de || f.ate ? `de ${f.de ? fmtDataBR(f.de) : 'início'} até ${f.ate ? fmtDataBR(f.ate) : 'hoje'}` : 'todo o período';
  const filtrosTxt = [f.municipio && 'Município: ' + f.municipio, f.bairro && 'Bairro: ' + f.bairro, f.status && 'Situação: ' + f.status].filter(Boolean).join(' · ');
  const colsDet = { demandas: ['Data', 'Assunto', 'Solicitante', 'Local', 'Situação'], servicos: ['Data', 'Ofício / serviço', 'Órgão', 'Local', 'Situação'], emendas: ['Data', 'Objeto', 'Beneficiário', 'Valor', 'Situação'], proposituras: ['Data', 'Ementa', 'Tipo / nº', 'Tema', 'Situação'], agenda: ['Data', 'Compromisso', 'Local', 'Contato', 'Situação'], tarefas: ['Prazo', 'Tarefa', 'Responsável', 'Relacionado a', 'Situação'], recepcao: ['Data', 'Nome', 'Motivo', 'Atendente', 'Situação'], pessoas: ['Cadastro', 'Nome', 'Tipo', 'Local', 'Telefone'] }[m];
  const linha = r => { const d = fmtDataBR(String(DATA_REL[m](r) || '').slice(0, 10)); const loc = [r.bairro, r.municipio].filter(Boolean).join(', ');
    const c = { demandas: [d, r.assunto, r.solicitante, loc, r.status], servicos: [d, r.servico, r.orgao, loc || r.local, r.status], emendas: [d, r.objeto, r.beneficiario, brl(val(r)), r.status], proposituras: [d, r.ementa, [r.tipo, r.numero && 'nº ' + r.numero].filter(Boolean).join(' '), r.tema, r.status], agenda: [d + (r.inicio ? ' ' + hhmm(r.inicio) : ''), r.titulo, r.local || r.municipio, r.contato, r.status], tarefas: [d, r.titulo, r.responsavel, r.relacionado, r.status], recepcao: [d + (r.hora_chegada ? ' ' + hhmm(r.hora_chegada) : ''), r.nome, r.motivo, r.atendente, r.status], pessoas: [d, r.nome, r.tipo, loc, r.telefone] }[m];
    return `<tr data-open="${m}:${r.id}">${c.map(x => `<td>${esc(x || '')}</td>`).join('')}</tr>`; };
  return `<div class="no-print" style="margin-bottom:8px"><button class="btn primary" data-go="graficos">📊 Ver relatórios em gráficos</button></div><h2 class="sec">Relatórios</h2><div class="m no-print" style="margin-top:2px">Escolha o assunto e o período. Para salvar em PDF, toque em "Imprimir / salvar PDF" e escolha <b>Salvar como PDF</b> no destino da impressora.</div>
    <div class="filters">
      ${sel('mod', 'Relatório de', ORDER.map(k => [k, MODS[k].label]), m, '')}
      <div class="f"><label for="rl-de">De</label><input id="rl-de" type="date" data-rel="de" value="${esc(f.de)}"></div>
      <div class="f"><label for="rl-ate">Até</label><input id="rl-ate" type="date" data-rel="ate" value="${esc(f.ate)}"></div>
      ${M.fields.some(x => x.k === 'municipio') ? sel('municipio', 'Município', uniq('municipio'), f.municipio) : ''}
      ${M.fields.some(x => x.k === 'bairro') ? sel('bairro', 'Bairro', uniq('bairro'), f.bairro) : ''}
      ${sel('status', 'Situação', M.statuses.map(s => s[0]), f.status)}
    </div>
    <div class="no-print" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px"><button class="btn primary" id="rel-print" ${rows.length ? '' : 'disabled'}>Imprimir / salvar PDF</button>
      <button class="btn ghost" data-rel-rapido="mes">Este mês</button><button class="btn ghost" data-rel-rapido="ano">Este ano</button><button class="btn ghost" data-rel-rapido="tudo">Tudo</button></div>
    <div class="rel">
      <div class="rel-head"><div class="eyebrow">${esc(NOME_GAB())}</div><h2 class="sec" style="margin:2px 0">Relatório de ${esc(M.label.toLowerCase())}</h2>
        <div class="m">${esc(periodo)}${filtrosTxt ? ' · ' + esc(filtrosTxt) : ''} · emitido em ${fmtStamp(new Date().toISOString())}</div></div>
      <div class="kpis rel-kpis"><div class="kpi"><span class="eyebrow">Total</span><span class="big">${rows.length}</span><span class="sub">registro(s)</span></div>
        ${m !== 'pessoas' && m !== 'agenda' ? `<div class="kpi"><span class="eyebrow">Concluídos</span><span class="big">${rows.filter(r => kindOf(m, r.status) === 'ok').length}</span><span class="sub">${rows.length ? Math.round(rows.filter(r => kindOf(m, r.status) === 'ok').length / rows.length * 100) : 0}% do total</span></div>
        <div class="kpi"><span class="eyebrow">Em aberto</span><span class="big">${rows.filter(r => isOpen(m, r)).length}</span><span class="sub">${M.deadline ? rows.filter(r => isLate(m, r)).length + ' atrasado(s)' : '&nbsp;'}</span></div>` : ''}
        ${m === 'emendas' ? `<div class="kpi"><span class="eyebrow">Valor</span><span class="big" style="font-size:20px">${brl(rows.reduce((s, r) => s + val(r), 0))}</span><span class="sub">${brl(rows.filter(r => r.status === 'Paga').reduce((s, r) => s + val(r), 0))} pago</span></div>` : ''}</div>
      ${rows.length ? `<div class="rel-grid">
        ${tabela('Por situação', conta('status', '—'))}
        ${M.fields.some(x => x.k === 'municipio') && !f.municipio ? tabela('Por município', conta('municipio', 'Sem município')) : ''}
        ${M.fields.some(x => x.k === 'bairro') ? tabela('Por bairro', conta('bairro', 'Sem bairro')) : ''}
        ${M.fields.some(x => x.k === 'area') ? (m === 'demandas' ? tabela('Por órgão destinatário', conta('area', 'Sem órgão')) : tabela('Por área', conta('area', 'Sem área'))) : ''}
        ${M.fields.some(x => x.k === 'tipo') ? tabela('Por tipo', conta('tipo', 'Sem tipo')) : ''}
        ${M.fields.some(x => x.k === 'responsavel') ? tabela('Por responsável', conta('responsavel', 'Sem responsável')) : ''}
      </div>
      <section class="panel" style="margin-top:14px"><h3>Lista (${rows.length})</h3><div class="rtab-wrap"><table class="rtab det"><thead><tr>${colsDet.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map(linha).join('')}</tbody></table></div></section>`
      : '<div class="empty"><b>Nenhum registro nesse filtro</b>Mude o período ou os filtros acima.</div>'}
    </div>`;
}
function fmtDataBR(s) { if (!s) return ''; const [y, mm, d] = s.split('-'); return d + '/' + mm + '/' + y; }

/* ---------- mapa por bairro ---------- */
let geoCache = null, mapaOcupado = false, mapaDeNovo = false;
const UF_GAB = () => (/[-–]\s*([A-Z]{2})\s*$/.exec(cfg.endereco_gabinete || '') || [])[1] || '';
const ORG_MAPA = { demandas: 'area', servicos: 'orgao' };
/** Registros do mapa depois dos filtros (situação, período e órgão). */
function regsMapa() {
  const { mod, so, per, org } = state.mapa; const ko = ORG_MAPA[mod];
  let desde = '';
  if (per === 'ano') desde = todayStr().slice(0, 4) + '-01-01';
  else if (per) desde = addDays(todayStr(), -(+per));
  return data[mod].filter(r => (so !== 'abertos' || isOpen(mod, r))
    && (!desde || String(r.criado_em || '').slice(0, 10) >= desde)
    && (!org || !ko || (org === '—' ? !r[ko] : r[ko] === org)));
}
function gruposMapa(regs) {
  const { mod } = state.mapa; const por = {};
  for (const r of regs) {
    if (r.lat != null && r.lng != null) continue;
    if (!r.bairro) continue;
    const mun = r.municipio || cfg.cidade_gabinete || '';
    const k = r.bairro.trim().toLowerCase() + '|' + mun.toLowerCase();
    const g = por[k] || (por[k] = { bairro: r.bairro.trim(), municipio: mun, total: 0, abertos: 0, atrasados: 0, itens: [] });
    g.total++; if (isOpen(mod, r)) g.abertos++; if (isLate(mod, r)) g.atrasados++;
    g.itens.push({ titulo: MODS[mod].title(r) || '', status: r.status });
  }
  return Object.values(por).sort((a, b) => b.total - a.total);
}
/** Ranking: todos os registros com bairro (com ou sem ponto exato). */
function rankingMapa(regs) {
  const { mod } = state.mapa; const por = {};
  for (const r of regs) {
    if (!r.bairro) continue;
    const mun = r.municipio || cfg.cidade_gabinete || '';
    const k = r.bairro.trim().toLowerCase() + '|' + mun.toLowerCase();
    const g = por[k] || (por[k] = { bairro: r.bairro.trim(), municipio: mun, total: 0, abertos: 0, atrasados: 0 });
    g.total++; if (isOpen(mod, r)) g.abertos++; if (isLate(mod, r)) g.atrasados++;
  }
  return Object.values(por).sort((a, b) => b.total - a.total || b.atrasados - a.atrasados);
}
function renderMapa() {
  const { mod, so, per = '', org = '' } = state.mapa; const M = MODS[mod]; const ko = ORG_MAPA[mod];
  const regs = regsMapa();
  const semBairro = regs.filter(r => !r.bairro && r.lat == null).length;
  const rank = rankingMapa(regs); const maxR = Math.max(1, ...rank.map(g => g.total));
  const orgs = ko ? [...new Set(data[mod].map(r => r[ko]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')) : [];
  const abertos = regs.filter(r => isOpen(mod, r)).length, atras = regs.filter(r => isLate(mod, r)).length;
  const comLocal = regs.filter(r => r.lat != null || r.bairro).length;
  const multi = new Set(rank.map(g => g.municipio)).size > 1;
  return `<div class="no-print"><a class="linkbtn" data-go="${mod}">← ${esc(M.label)}</a></div>
    <h2 class="sec" style="margin-top:6px">Mapa</h2>
    <div class="m">Círculos juntam os pedidos de um bairro (o número é a quantidade). Pontos pequenos são pedidos com o local exato marcado. Toque num deles e em <b>+ Roteiro</b> para montar a rota de visitas.</div>
    <div class="toolbar" style="margin-top:10px"><div class="chips">
      ${['demandas', 'servicos', 'pessoas'].map(k => chip('data-mapa-mod', k, MODS[k].label, mod === k)).join('')}
      ${mod !== 'pessoas' ? chip('data-mapa-so', 'abertos', 'Só em aberto', so === 'abertos') + chip('data-mapa-so', 'todos', 'Todos', so !== 'abertos') : ''}
    </div></div>
    <div class="filters mapa-filtros">
      <div class="f"><label for="mapa-per">Período</label><select id="mapa-per">${[['', 'Todo o período'], ['30', 'Últimos 30 dias'], ['90', 'Últimos 90 dias'], ['ano', 'Este ano']].map(([k, l]) => `<option value="${k}" ${per === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      ${ko ? `<div class="f"><label for="mapa-org">Órgão destinatário</label><select id="mapa-org"><option value="">Todos os órgãos</option>${orgs.map(o => `<option ${org === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}<option value="—" ${org === '—' ? 'selected' : ''}>Sem órgão</option></select></div>` : ''}
    </div>
    <div class="mapa-resumo"><span><b>${regs.length}</b> ${mod === 'pessoas' ? 'pessoa(s)' : 'registro(s)'}</span>${mod !== 'pessoas' ? `<span><b>${abertos}</b> em aberto</span>${atras ? `<span class="late"><b>${atras}</b> atrasado(s)</span>` : ''}` : ''}<span><b>${comLocal}</b> no mapa</span></div>
    <div class="m" id="mapa-prog" hidden></div>
    <div class="mapa-grade">
      <div class="mapa-wrap"><div id="mapa-el" class="mapa"></div></div>
      <section class="panel mapa-rank"><h3>Bairros com mais ${mod === 'pessoas' ? 'pessoas' : 'pedidos'}</h3>
        ${rank.length ? `<ol>${rank.slice(0, 15).map(g => `<li><button data-mapa-foco="${esc(g.bairro)}" data-mapa-foco-mun="${esc(g.municipio)}" title="Ver no mapa"><span class="nm">${esc(g.bairro)}${multi && g.municipio ? ` <small>${esc(g.municipio)}</small>` : ''}</span><span class="nr">${g.total}</span><span class="bar"><i style="width:${Math.round(100 * g.total / maxR)}%;background:${g.atrasados ? '#e5484d' : g.abertos ? '#f0a020' : '#3fb06a'}"></i></span>${mod !== 'pessoas' && (g.abertos || g.atrasados) ? `<span class="sub">${g.abertos} em aberto${g.atrasados ? ' · <b>' + g.atrasados + ' atrasado(s)</b>' : ''}</span>` : ''}</button></li>`).join('')}</ol>${rank.length > 15 ? `<p class="m" style="margin:6px 0 0">e mais ${rank.length - 15} bairro(s)</p>` : ''}` : '<p class="m">Nenhum registro com bairro nesse filtro.</p>'}
      </section>
    </div>
    <div id="rota-box">${rotaHtml()}</div>
    <div class="m" id="mapa-info" style="margin-top:8px">${semBairro ? semBairro + ' registro(s) sem bairro preenchido não aparecem no mapa.' : ''}</div>`;
}
/** Centro de cada bairro pelos pedidos que têm o ponto exato marcado (mediana, para ignorar um ponto fora). */
function pinsPorBairro() {
  const por = {};
  for (const m of ['demandas', 'servicos', 'pessoas']) for (const r of data[m] || []) {
    if (r.lat == null || r.lng == null || !r.bairro) continue;
    const k = mapaLib.chave(r.bairro.trim(), r.municipio || cfg.cidade_gabinete || '');
    (por[k] || (por[k] = [])).push([+r.lat, +r.lng]);
  }
  const med = a => { a = a.slice().sort((x, y) => x - y); const i = a.length >> 1; return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2; };
  const out = {}; for (const k in por) out[k] = [med(por[k].map(p => p[0])), med(por[k].map(p => p[1]))];
  return out;
}
async function desenharMapa() {
  const el = $('#mapa-el'); if (!el) return;
  if (mapaOcupado) { mapaDeNovo = true; return; }
  mapaOcupado = true;
  try {
    if (!geoCache) { try { geoCache = (await store.getConfig('geo')) || {}; } catch { geoCache = {}; } }
    const mod = state.mapa.mod, regs = regsMapa();
    const grupos = gruposMapa(regs);
    const semLocal = await mapaLib.desenhar(el, grupos, {
      cache: geoCache, uf: UF_GAB() || 'PR', cidadePadrao: cfg.cidade_gabinete, esc,
      salvarCache: c => store.setConfig('geo', c),
      onProgresso: (i, n) => { const p = $('#mapa-prog'); if (!p) return; p.hidden = !n; p.textContent = n ? `Localizando bairros no mapa… ${i} de ${n} (só na primeira vez)` : ''; },
      onClique: g => { mapaLib.destruir(); state.qNext = g.bairro; go(mod); },
      pinsBairro: pinsPorBairro(),
      pontosExatos: regs.filter(r => r.lat != null && r.lng != null).map(r => ({ id: r.id, lat: +r.lat, lng: +r.lng, titulo: MODS[mod].title(r) || '', status: r.status, sub: [r.bairro, r.solicitante].filter(Boolean).join(' · '), bairro: (r.bairro || '').trim(), municipio: r.municipio || cfg.cidade_gabinete || '', aberto: isOpen(mod, r), atrasado: isLate(mod, r) })),
      onAbrir: p => { mapaLib.sairTelaCheia(); openDrawer(mod, p.id); },
      onAviso: toast,
      onRota: p => { if (state.rota.length >= 10) { toast('O Google Maps aceita até 10 paradas.'); return; } if (state.rota.some(x => x.lat === p.lat && x.lng === p.lng)) { toast('Já está no roteiro'); return; } state.rota.push(p); atualizarRota(); toast('Adicionado ao roteiro'); },
    });
    const info = $('#mapa-info');
    if (info && semLocal.length) info.textContent += (info.textContent ? ' ' : '') + 'Não achei no mapa: ' + semLocal.map(g => g.bairro).join(', ') + '.';
    if (!grupos.length && info && !regs.some(r => r.lat != null)) info.textContent = 'Nenhum registro com bairro preenchido nesse filtro.';
  } catch (e) { const info = $('#mapa-info'); if (info) info.textContent = 'Não foi possível abrir o mapa: ' + errMsg(e); }
  finally { mapaOcupado = false; if (mapaDeNovo) { mapaDeNovo = false; desenharMapa(); } }
}

/* ---------- importar planilha ---------- */
function renderImportar() {
  const s = state.imp, M = MODS[s.mod];
  const campos = [['', '— não importar —'], ['status', 'Situação']].concat(M.fields.filter(f => f.type !== 'bool').map(f => [f.k, f.l + (f.req ? ' *' : '')]));
  let corpo = '';
  if (s.cabecalho) {
    const { regs, semObrig } = imp.montarRegistros(s.mod, s.linhas, s.mapa, myName());
    const { regs: finais, dup } = imp.semDuplicados(s.mod, regs, data[s.mod]);
    const exemplo = i => s.linhas.slice(0, 3).map(l => l[i] instanceof Date ? fmtDataBR(ymd(l[i])) : l[i]).filter(v => v != null && v !== '').map(v => String(v).slice(0, 40)).join(' · ');
    const faltando = M.fields.filter(f => f.req && !s.mapa.includes(f.k)).map(f => f.l);
    corpo = `<section class="panel"><h3>2. Confira as colunas <span class="m" style="font-weight:400">${esc(s.arquivo)} · ${s.linhas.length} linha(s)</span></h3>
      <p class="m" style="margin-top:0">Para cada coluna da sua planilha, escolha o campo do sistema. Já deixei sugerido o que reconheci.</p>
      <table class="rtab imp"><thead><tr><th>Coluna da planilha</th><th>Exemplos</th><th>Vai para o campo</th></tr></thead><tbody>
      ${s.cabecalho.map((h, i) => `<tr><td><b>${esc(h || '(sem título)')}</b></td><td class="m">${esc(exemplo(i))}</td><td><select data-imp-col="${i}">${campos.map(([k, l]) => `<option value="${k}" ${s.mapa[i] === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></td></tr>`).join('')}
      </tbody></table></section>
      <section class="panel" style="margin-top:14px"><h3>3. Importar</h3>
        ${faltando.length ? `<div class="err">Escolha uma coluna para: ${esc(faltando.join(', '))}.</div>` : ''}
        <p class="m" style="margin-top:0"><b>${finais.length}</b> registro(s) serão criados em ${esc(M.label)}.${semObrig ? ` ${semObrig} linha(s) sem ${esc(M.fields.filter(f => f.req).map(f => f.l).join(' / '))} serão puladas.` : ''}${dup ? ` ${dup} pessoa(s) que já estão cadastradas serão puladas.` : ''}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" id="imp-go" ${finais.length && !faltando.length ? '' : 'disabled'}>Importar ${finais.length} registro(s)</button><button class="btn ghost" id="imp-reset">Escolher outra planilha</button></div></section>`;
  }
  return `<div class="no-print"><a class="linkbtn" data-go="${s.mod}">← ${esc(M.label)}</a></div>
    <h2 class="sec" style="margin-top:6px">Importar planilha</h2>
    <div class="m">Traga para o sistema os cadastros que hoje estão no Excel. Nada é apagado; os registros importados são somados aos que já existem.</div>
    <section class="panel" style="margin-top:14px"><h3>1. Escolha a planilha</h3>
      <div class="filters" style="margin:0 0 10px">
        <div class="f"><label for="imp-mod">Importar para</label><select id="imp-mod">${ORDER.map(k => `<option value="${k}" ${k === s.mod ? 'selected' : ''}>${esc(MODS[k].label)}</option>`).join('')}</select></div>
      </div>
      <label class="btn" style="cursor:pointer">${s.cabecalho ? 'Trocar planilha' : 'Escolher arquivo (.xlsx ou .csv)'}<input type="file" id="imp-file" accept=".xlsx,.csv,.txt,.xls" hidden></label>
      <p class="m">A primeira linha precisa ter os títulos das colunas, por exemplo: <i>Nome, Telefone, Bairro, Cidade, Aniversário</i>.</p></section>
    ${corpo}`;
}
async function importarAgora() {
  const s = state.imp, btn = $('#imp-go'); if (btn) { btn.disabled = true; btn.textContent = 'Importando…'; }
  try {
    const { regs } = imp.montarRegistros(s.mod, s.linhas, s.mapa, myName());
    const { regs: finais } = imp.semDuplicados(s.mod, regs, data[s.mod]);
    const rows = await store.insertMany(s.mod, finais, (n, t) => { if (btn) btn.textContent = `Importando… ${n} de ${t}`; });
    rows.forEach(r => { if (!data[s.mod].some(x => x.id === r.id)) data[s.mod].unshift(r); });
    toast(rows.length + ' registro(s) importado(s)');
    const mod = s.mod; state.imp = { mod }; go(mod);
  } catch (e) { toast('Não foi possível importar: ' + errMsg(e)); if (btn) { btn.disabled = false; btn.textContent = 'Tentar de novo'; } }
}

/* ---------- formulário público ---------- */
const linkPublico = () => location.origin + location.pathname + '?solicitar';
/* fotos escolhidas no formulário do cidadão (sobrevivem ao redesenho da tela) */
let fotosPub = [];
async function fotoJpeg(f, max = 1600) {
  const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
  if (!blob) throw new Error('falha');
  return blob;
}
/* ---------- trava de telefone ---------- */
/** Só números, sem o +55; no máximo 11 dígitos (DDD + número). */
const digitosTel = v => { let d = String(v || '').replace(/\D/g, ''); if (d.length > 11 && d.startsWith('55')) d = d.slice(2); if (d.length > 11 && d.startsWith('0')) d = d.replace(/^0+/, ''); return d.slice(0, 11); };
/** (45) 99999-9999 ou (45) 3333-4444 enquanto digita. */
function mascaraTel(v) {
  const d = digitosTel(v);
  if (!d) return '';
  if (d.length <= 2) return '(' + d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
const dddOk = d => /^[1-9][1-9]/.test(d);
const celularOk = v => { const d = digitosTel(v); return d.length === 11 && dddOk(d) && d[2] === '9'; };
const telefoneOk = v => { const d = digitosTel(v); return celularOk(d) || (d.length === 10 && dddOk(d) && /[2-5]/.test(d[2])); };

function renderFormPublico(msg = '', ok = false, vals = {}) {
  document.title = 'Fala Cascavel · Fale com o gabinete';
  if (ok) {
    document.body.innerHTML = `<div class="login portal">${topoPortal('consulta')}<div class="login-card pub">${marcaPub()}
      ${tituloPortal('Pedido recebido!', 'Obrigado. A equipe do gabinete do ' + esc(DEP()) + ' vai analisar e entrar em contato pelo telefone informado.')}${vals.protocolo ? `<div class="prot-box"><span class="m">Seu número de protocolo</span><b class="num">${esc(vals.protocolo)}</b><span class="m">Anote ou tire um print. Com ele e o seu celular você acompanha o pedido.</span><a class="btn primary" href="${esc(linkConsulta(vals.protocolo))}">Acompanhar meu pedido</a></div>` : ''}${vals.avisoFotos ? `<p class="m">${esc(vals.avisoFotos)}</p>` : ''}
      <button class="btn" id="fp-outro" style="justify-content:center">Fazer outro pedido</button></div></div>`;
    $('#fp-outro').addEventListener('click', () => renderFormPublico());
    return;
  }
  const v = k => esc(vals[k] ?? (k === 'municipio' ? cfg.cidade_gabinete : '') ?? '');
  document.body.innerHTML = `<div class="login portal">${topoPortal('consulta')}<form class="login-card pub" id="fpub" novalidate>
    ${marcaPub()}
    ${tituloPortal('Fale com o gabinete', 'Conte o que você precisa: um buraco na rua, iluminação, saúde, um pedido para o seu bairro. A equipe responde pelo WhatsApp.')}
    <div class="f"><label for="fp-nome">Seu nome *</label><input id="fp-nome" autocomplete="name" maxlength="120" value="${v('nome')}"></div>
    <div class="f"><label for="fp-tel">WhatsApp / telefone *</label><input id="fp-tel" type="tel" inputmode="numeric" autocomplete="tel" maxlength="20" placeholder="(45) 99999-9999" value="${esc(mascaraTel(vals.telefone))}"></div>
    <div class="f"><label for="fp-mun">Cidade</label><input id="fp-mun" maxlength="80" value="${v('municipio')}"></div>
    <div class="f"><label for="fp-bairro">Bairro</label><input id="fp-bairro" maxlength="80" value="${v('bairro')}"></div>
    <div class="f"><label for="fp-ass">Qual é o pedido? *</label><input id="fp-ass" maxlength="200" placeholder="Ex.: Troca de lâmpada na Rua das Flores" value="${v('assunto')}"></div>
    <div class="f"><label for="fp-desc">Detalhes (endereço, ponto de referência…)</label><textarea id="fp-desc" maxlength="3000">${v('descricao')}</textarea></div>
    <div class="f"><label>Fotos do local <span class="m" style="font-weight:400">(opcional, até 5)</span></label>
      <div class="fp-fotos">${fotosPub.map((x, i) => `<div class="fp-foto"><img src="${x.url}" alt="Foto ${i + 1}"><button type="button" data-fp-tirar="${i}" aria-label="Tirar foto ${i + 1}">✕</button></div>`).join('')}
      ${fotosPub.length < 5 ? `<label class="btn fp-add">📷 ${fotosPub.length ? 'Mais fotos' : 'Tirar foto ou escolher da galeria'}<input id="fp-foto" type="file" accept="image/*" multiple hidden></label>` : ''}</div></div>
    <div><button class="btn" type="button" id="fp-gps">📍 ${vals.lat != null ? 'Localização marcada ✓' : 'Estou no local: enviar minha localização'}</button></div>
    <div class="hp" aria-hidden="true"><label for="fp-site">Não preencha</label><input id="fp-site" tabindex="-1" autocomplete="off"></div>
    ${msg ? `<div class="err">${esc(msg)}</div>` : ''}
    <button class="btn primary" type="submit" style="justify-content:center">Enviar pedido</button>
    <div class="m" style="font-size:11.5px">Seus dados são usados só para o gabinete responder ao seu pedido.</div></form></div>`;
  const lerCampos = () => ({ nome: $('#fp-nome').value.trim(), telefone: $('#fp-tel').value.trim(), municipio: $('#fp-mun').value.trim(), bairro: $('#fp-bairro').value.trim(), assunto: $('#fp-ass').value.trim(), descricao: $('#fp-desc').value.trim(), lat: vals.lat, lng: vals.lng });
  const fi = $('#fp-foto');
  if (fi) fi.addEventListener('change', async () => {
    const arqs = [...fi.files].slice(0, 5 - fotosPub.length); const campos = lerCampos(); let falhou = 0;
    const lb = fi.closest('label'); if (lb) lb.firstChild.textContent = 'Preparando fotos… ';
    for (const f of arqs) { try { const blob = await fotoJpeg(f); fotosPub.push({ blob, url: globalThis.URL.createObjectURL(blob) }); } catch { falhou++; } }
    renderFormPublico(falhou ? 'Não consegui abrir ' + falhou + ' foto(s). Tente tirar de novo ou escolher outra.' : '', false, campos);
  });
  document.querySelectorAll('[data-fp-tirar]').forEach(b => b.addEventListener('click', () => { const [x] = fotosPub.splice(+b.dataset.fpTirar, 1); if (x) globalThis.URL.revokeObjectURL(x.url); renderFormPublico('', false, lerCampos()); }));
  $('#fp-gps').addEventListener('click', () => {
    if (!navigator.geolocation) return renderFormPublico('Este aparelho não tem localização.', false, lerCampos());
    const b = $('#fp-gps'); b.disabled = true; b.textContent = 'Localizando…';
    navigator.geolocation.getCurrentPosition(pos => renderFormPublico('', false, { ...lerCampos(), lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => renderFormPublico('Não consegui pegar a localização. Permita o acesso no navegador ou escreva o endereço.', false, lerCampos()), { enableHighAccuracy: true, timeout: 15000 });
  });
  $('#fpub').addEventListener('submit', async e => {
    e.preventDefault();
    const c = { lat: vals.lat, lng: vals.lng, nome: $('#fp-nome').value.trim(), telefone: $('#fp-tel').value.trim(), municipio: $('#fp-mun').value.trim(), bairro: $('#fp-bairro').value.trim(), assunto: $('#fp-ass').value.trim(), descricao: $('#fp-desc').value.trim() };
    if ($('#fp-site').value) return renderFormPublico('', true);
    if (!c.nome || !c.assunto) return renderFormPublico('Preencha seu nome e o pedido.', false, c);
    if (!celularOk(c.telefone)) return renderFormPublico('Digite um número de celular válido, com DDD: (45) 99999-9999.', false, c);
    c.telefone = mascaraTel(c.telefone);
    const b = e.target.querySelector('[type=submit]'); b.disabled = true; b.textContent = 'Enviando…';
    try {
      // primeiro as fotos, depois o pedido já com elas
      const pasta = 'publico/' + (crypto.randomUUID ? crypto.randomUUID() : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, x => (x ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> x / 4).toString(16)));
      const fotos = []; let falhas = 0;
      for (let i = 0; i < fotosPub.length; i++) {
        b.textContent = `Enviando foto ${i + 1} de ${fotosPub.length}…`;
        const path = `${pasta}/${i + 1}.jpg`;
        try { await store.enviarFotoPublica(path, fotosPub[i].blob); fotos.push(path); } catch { falhas++; }
      }
      b.textContent = 'Enviando pedido…';
      const r = await store.novaDemandaPublica({ ...c, fotos });
      const avisoFotos = fotosPub.length && (falhas === fotosPub.length || r?.semFotos) ? 'Não foi possível enviar as fotos. Se quiser, mande pelo WhatsApp do gabinete.' : falhas ? `${falhas} foto(s) não foram enviadas.` : '';
      fotosPub.forEach(x => globalThis.URL.revokeObjectURL(x.url)); fotosPub = [];
      renderFormPublico('', true, { avisoFotos, protocolo: r?.protocolo, telefone: c.telefone });
    }
    catch (err) { renderFormPublico(errMsg(err), false, c); }
  });
}

/* ---------- painel de emendas ---------- */
const VAL_EM = r => {
  const ind = +r.valor_indicado || 0, emp = +r.valor_empenhado || 0, pag = +r.valor_pago || 0;
  const st = r.status;
  const indicado = ['Indicada', 'Empenhada', 'Paga'].includes(st) ? (ind || emp || pag) : 0;
  const empenhado = emp || (['Empenhada', 'Paga'].includes(st) ? ind : 0);
  const pago = pag || (st === 'Paga' ? (emp || ind) : 0);
  return { pedido: +r.valor_pedido || 0, indicado, empenhado, pago };
};
const anoEmenda = r => String(r.exercicio || String(r.criado_em || '').slice(0, 4) || '—');
function renderResumoEmendas() {
  const f = state.rem;
  const anos = [...new Set(data.emendas.map(anoEmenda))].sort().reverse();
  const base = data.emendas.filter(r => r.status !== 'Não atendida' && (!f.ano || anoEmenda(r) === f.ano) && (!f.municipio || r.municipio === f.municipio));
  const soma = rows => rows.reduce((a, r) => { const v = VAL_EM(r); a.pedido += v.pedido; a.indicado += v.indicado; a.empenhado += v.empenhado; a.pago += v.pago; a.n++; return a; }, { pedido: 0, indicado: 0, empenhado: 0, pago: 0, n: 0 });
  const tot = soma(base);
  const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';
  const agrupa = (fn) => { const g = {}; base.forEach(r => { const k = fn(r) || '—'; (g[k] = g[k] || []).push(r); }); return Object.entries(g).map(([k, rs]) => [k, soma(rs)]); };
  const tabela = (titulo, linhas, ordenar) => `<section class="panel"><h3>${titulo}</h3><div class="rtab-wrap"><table class="rtab"><thead><tr><th></th><th class="num">Pedidos</th><th class="num">Indicado</th><th class="num">Empenhado</th><th class="num">Pago</th><th class="num">Pago / indicado</th></tr></thead><tbody>
    ${linhas.sort(ordenar).map(([k, v]) => `<tr><td><b>${esc(k)}</b> <span class="m">(${v.n})</span></td><td class="num">${brl(v.pedido)}</td><td class="num">${brl(v.indicado)}</td><td class="num">${brl(v.empenhado)}</td><td class="num"><b>${brl(v.pago)}</b></td><td class="num"><span class="barra-mini"><i style="width:${v.indicado ? Math.min(100, v.pago / v.indicado * 100) : 0}%"></i></span> ${pct(v.pago, v.indicado)}</td></tr>`).join('')}
    </tbody></table></div></section>`;
  const sel = (id, label, opts, v) => `<div class="f"><label for="re-${id}">${label}</label><select id="re-${id}" data-rem="${id}"><option value="">Todos</option>${opts.map(o => `<option ${String(o) === String(v) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
  const munis = [...new Set(data.emendas.map(r => r.municipio).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const etapa = (rot, v, cor, sub) => `<div class="kpi"><span class="eyebrow">${rot}</span><span class="big" style="font-size:22px;color:${cor}">${brl(v)}</span><span class="sub">${sub}</span></div>`;
  return `<div class="no-print"><a class="linkbtn" data-go="emendas">← Emendas</a></div>
    <h2 class="sec" style="margin-top:6px">Painel de emendas</h2>
    <div class="m">Quanto foi pedido, indicado, empenhado e pago. Preencha "Valor empenhado" e "Valor pago" em cada emenda para os números ficarem exatos; sem eles, o painel usa a situação da emenda.</div>
    <div class="filters">${sel('ano', 'Exercício (ano)', anos, f.ano)}${sel('municipio', 'Município', munis, f.municipio)}</div>
    <div class="no-print" style="margin-bottom:12px"><button class="btn primary" id="rel-print">Imprimir / salvar PDF</button></div>
    <div class="rel"><div class="rel-head print-only"><div class="eyebrow">${esc(NOME_GAB())}</div><h2 class="sec">Painel de emendas${f.ano ? ' · ' + esc(f.ano) : ''}${f.municipio ? ' · ' + esc(f.municipio) : ''}</h2></div>
    <div class="kpis">${etapa('Pedido', tot.pedido, 'var(--muted)', tot.n + ' emenda(s)')}${etapa('Indicado', tot.indicado, 'var(--azul)', 'compromisso do mandato')}${etapa('Empenhado', tot.empenhado, '#9a5b00', pct(tot.empenhado, tot.indicado) + ' do indicado')}${etapa('Pago', tot.pago, 'var(--accent)', pct(tot.pago, tot.indicado) + ' do indicado')}</div>
    ${base.length ? `<div style="display:flex;flex-direction:column;gap:14px;margin-top:14px">
      ${f.ano ? '' : tabela('Por ano', agrupa(anoEmenda), (a, b) => b[0].localeCompare(a[0]))}
      ${tabela('Por município', agrupa(r => r.municipio), (a, b) => b[1].indicado - a[1].indicado)}
      ${tabela('Por área', agrupa(r => r.area), (a, b) => b[1].indicado - a[1].indicado)}
      ${tabela('Por beneficiário', agrupa(r => r.beneficiario), (a, b) => b[1].indicado - a[1].indicado)}
    </div>` : '<div class="empty"><b>Nenhuma emenda nesse filtro</b>Cadastre as emendas na aba Emendas.</div>'}</div>`;
}

/* ---------- histórico do cidadão ---------- */
const normNome = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const dig8 = t => String(t || '').replace(/\D/g, '').slice(-8);
function registrosDoCidadao(nome, tel) {
  const n = normNome(nome), d = dig8(tel); const out = [];
  const bate = (vals, fone) => vals.some(v => v && normNome(v) === n) || (d.length === 8 && dig8(fone) === d);
  data.demandas.forEach(r => { if (bate([r.solicitante], r.telefone)) out.push(['demandas', r]); });
  data.servicos.forEach(r => { if (bate([r.solicitante], r.telefone)) out.push(['servicos', r]); });
  data.emendas.forEach(r => { if (bate([r.beneficiario, r.quem_pediu])) out.push(['emendas', r]); });
  data.agenda.forEach(r => { if (bate([r.contato])) out.push(['agenda', r]); });
  data.tarefas.forEach(r => { if (n && normNome(r.relacionado).includes(n)) out.push(['tarefas', r]); });
  data.recepcao.forEach(r => { if (bate([r.nome], r.telefone)) out.push(['recepcao', r]); });
  data.pessoas.forEach(r => { if (r.indicado_por && normNome(r.indicado_por) === n) out.push(['pessoas', r]); });
  return out.sort((a, b) => String(b[1].criado_em || '').localeCompare(String(a[1].criado_em || '')));
}
function abrirCidadao(nome, tel) { state.cid = { nome, tel }; go('cidadao'); }
function renderCidadao() {
  const c = state.cid || {}; if (!c.nome) return '<div class="empty"><b>Escolha uma pessoa</b>Abra uma pessoa ou demanda e toque em “Histórico do cidadão”.</div>';
  const p = data.pessoas.find(x => normNome(x.nome) === normNome(c.nome)) || null;
  const tel = c.tel || p?.telefone;
  const regs = registrosDoCidadao(c.nome, tel);
  const pedidos = regs.filter(([m]) => ['demandas', 'servicos', 'emendas'].includes(m));
  const resolvidos = pedidos.filter(([m, r]) => kindOf(m, r.status) === 'ok').length;
  const abertos = pedidos.filter(([m, r]) => isOpen(m, r)).length;
  const atrasados = pedidos.filter(([m, r]) => isLate(m, r)).length;
  const wa = waLink(tel, `Olá, ${primeiroNome(c.nome)}! Aqui é do gabinete do ${DEP()}.`);
  const rot = { demandas: 'Demanda', servicos: 'Ofício', emendas: 'Emenda', agenda: 'Agenda', tarefas: 'Tarefa', recepcao: 'Visita ao gabinete', pessoas: 'Indicou' };
  return `<div class="no-print"><a class="linkbtn" data-go="${p ? 'pessoas' : 'demandas'}">← Voltar</a></div>
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap;margin-top:6px">
      <div><div class="eyebrow">Histórico do cidadão</div><h2 class="sec" style="margin:2px 0">${esc(c.nome)}</h2>
        <div class="m">${esc([p?.tipo, p?.bairro, p?.municipio, tel].filter(Boolean).join(' · ') || 'Sem cadastro em Pessoas')}</div></div>
      <div class="no-print" style="display:flex;gap:8px;flex-wrap:wrap">${wa ? `<a class="btn wa" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}${p ? `<button class="btn" data-open="pessoas:${p.id}">Cadastro</button>` : `<button class="btn" data-cid-cadastrar>Cadastrar em Pessoas</button>`}<button class="btn primary" data-cid-nova>+ Nova demanda</button><button class="btn" id="rel-print">Imprimir</button></div>
    </div>
    <div class="kpis" style="margin-top:12px">
      <div class="kpi"><span class="eyebrow">Pedidos</span><span class="big">${pedidos.length}</span><span class="sub">demandas, ofícios e emendas</span></div>
      <div class="kpi"><span class="eyebrow">Resolvidos</span><span class="big" style="color:var(--accent)">${resolvidos}</span><span class="sub">${pedidos.length ? Math.round(resolvidos / pedidos.length * 100) : 0}% do total</span></div>
      <div class="kpi"><span class="eyebrow">Em aberto</span><span class="big">${abertos}</span><span class="sub">${atrasados ? `<span class="alert">${atrasados} atrasado(s)</span>` : 'nenhum atrasado'}</span></div>
      <div class="kpi"><span class="eyebrow">Desde</span><span class="big" style="font-size:20px">${regs.length ? fmtDataBR(String(regs[regs.length - 1][1].criado_em || '').slice(0, 10)) : '—'}</span><span class="sub">primeiro registro</span></div>
    </div>
    <section class="panel" style="margin-top:14px"><h3>Linha do tempo (${regs.length})</h3>
      ${regs.length ? `<div class="timeline">${regs.map(([m, r]) => { const late = isLate(m, r); return `<button class="tl-item" data-open="${m}:${r.id}"><span class="tl-dot ${late ? 'k-late' : STATUS_KIND[kindOf(m, r.status)]}"></span><span class="tl-when">${fmtDataBR(String(r.criado_em || '').slice(0, 10))}</span><span class="tl-body"><span class="eyebrow">${rot[m]}</span><b>${esc(MODS[m].title(r) || '')}</b><span class="m">${esc(MODS[m].meta(r))}</span>${r.historico?.length > 1 ? `<span class="m">Último andamento: ${esc(r.historico[r.historico.length - 1].txt)}</span>` : ''}</span><span class="pill ${late ? 'k-late' : STATUS_KIND[kindOf(m, r.status)]}">${late ? 'Atrasado' : esc(r.status)}</span></button>`; }).join('')}</div>`
        : '<div class="empty"><b>Nenhum registro ligado a esta pessoa</b>Os registros são ligados pelo nome do solicitante ou pelo telefone.</div>'}
    </section>`;
}

/* ---------- prestação de contas pública ---------- */
const linkPrestacao = () => location.origin + location.pathname + '?prestacao';
/* ---------- relatórios com gráficos ---------- */
const PERIODOS = [['30', 'Últimos 30 dias'], ['90', 'Últimos 3 meses'], ['ano', 'Este ano'], ['12m', 'Últimos 12 meses'], ['tudo', 'Tudo']];
function periodoGraf() {
  const g = state.graf || (state.graf = { p: '12m', de: '', ate: '' });
  const t = todayStr(); let de = '', ate = t;
  if (g.p === '30') de = addDays(t, -29); else if (g.p === '90') de = addDays(t, -89);
  else if (g.p === 'ano') de = t.slice(0, 4) + '-01-01'; else if (g.p === '12m') de = ymd(new Date(+t.slice(0, 4) - 1, +t.slice(5, 7), 1));
  else if (g.p === 'livre') { de = g.de; ate = g.ate || t; }
  return { de, ate };
}
const diaDe = v => String(v || '').slice(0, 10);
const noPeriodo = (v, { de, ate }) => { const d = diaDe(v); return !!d && (!de || d >= de) && (!ate || d <= ate); };
/** Barras horizontais (uma cor só, rótulo e número em texto). */
function grafBarras(pares, { cor = 'var(--accent)', fmt = v => v, max = 10, total, vazio = 'Nada no período.' } = {}) {
  if (!pares.length) return `<div class="m">${vazio}</div>`;
  const resto = pares.slice(max); const lista = pares.slice(0, max);
  if (resto.length) lista.push(['Outros (' + resto.length + ')', resto.reduce((a, x) => a + x[1], 0), null]);
  const top = Math.max(...lista.map(x => x[1]), 1);
  return `<div class="gb">${lista.map(([k, v, c]) => `<div class="gb-l" title="${esc(k)}: ${esc(fmt(v))}${total ? ' (' + Math.round(v / total * 100) + '%)' : ''}"><span class="gb-k">${esc(k)}</span><span class="gb-t"><i style="width:${Math.max(v / top * 100, v ? 1.5 : 0).toFixed(1)}%;background:${c || cor}"></i></span><span class="gb-v num">${esc(fmt(v))}${total ? `<small>${Math.round(v / total * 100)}%</small>` : ''}</span></div>`).join('')}</div>`;
}
/** Colunas por mês (uma série). */
function grafMeses(meses, { cor = 'var(--accent)', fmt = v => v, alto = 150, mini = false } = {}) {
  const top = Math.max(...meses.map(x => x[1]), 1);
  const lim = mini ? 4 : 12; const passo = meses.length > lim ? Math.ceil(meses.length / lim) : 1;
  return `<div class="gm" style="--alto:${alto}px">${meses.map(([k, v], i) => `<div class="gm-c" title="${esc(nomeMes(k))}: ${esc(fmt(v))}">${mini ? '' : `<span class="gm-v num">${v ? esc(fmt(v)) : ''}</span>`}<span class="gm-b"><i style="height:${(v / top * 100).toFixed(1)}%;background:${cor}"></i></span><span class="gm-k">${i % passo === 0 ? esc(nomeMesCurto(k)) : ''}</span></div>`).join('')}</div>`;
}
const nomeMes = k => MESES[+k.slice(5, 7) - 1] + ' de ' + k.slice(0, 4);
const nomeMesCurto = k => MESES[+k.slice(5, 7) - 1].slice(0, 3).toLowerCase() + (k.slice(5, 7) === '01' ? '/' + k.slice(2, 4) : '');
function mesesDoPeriodo({ de, ate }, linhas) {
  const ini = de || linhas.map(diaDe).filter(Boolean).sort()[0] || todayStr();
  const out = []; let [y, m] = ini.slice(0, 7).split('-').map(Number); const fim = (ate || todayStr()).slice(0, 7);
  while (out.length < 36) { const k = y + '-' + pad(m); out.push(k); if (k >= fim) break; m++; if (m > 12) { m = 1; y++; } }
  return out.slice(-24);
}
const contarPor = (rows, fn) => { const c = {}; rows.forEach(r => { const k = fn(r); if (k) c[k] = (c[k] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1]); };
/** Dias entre a abertura e a conclusão (pelo histórico; senão pela última atualização). */
function diasParaResolver(r) {
  const h = (r.historico || []).find(x => /→\s*Concluída/.test(x.txt || ''));
  const fim = h ? h.em : r.atualizado_em; if (!fim || !r.criado_em) return null;
  const d = (new Date(fim) - new Date(r.criado_em)) / 864e5; return d >= 0 ? d : null;
}
function renderGraficos() {
  const g = state.graf || (state.graf = { p: '12m', de: '', ate: '' }); const per = periodoGraf();
  const dem = data.demandas.filter(r => noPeriodo(r.criado_em, per));
  const conc = dem.filter(r => r.status === 'Concluída');
  const tempos = data.demandas.filter(r => r.status === 'Concluída').map(r => [r, diasParaResolver(r)]).filter(([r, d]) => d != null && noPeriodo(((r.historico || []).find(x => /→\s*Concluída/.test(x.txt || '')) || {}).em || r.atualizado_em, per)).map(x => x[1]);
  const mediaDias = tempos.length ? tempos.reduce((a, b) => a + b, 0) / tempos.length : null;
  const site = dem.filter(r => r.origem === 'Site do gabinete').length;
  const notas = data.demandas.filter(r => r.nota != null && noPeriodo(r.nota_em || r.atualizado_em, per));
  const media = notas.length ? (notas.reduce((a, r) => a + +r.nota, 0) / notas.length).toFixed(1).replace('.', ',') : '—';
  const meses = mesesDoPeriodo(per, data.demandas.map(r => r.criado_em));
  const porMes = (rows, dataFn, valFn = () => 1) => meses.map(k => [k, rows.filter(r => diaDe(dataFn(r)).startsWith(k)).reduce((a, r) => a + valFn(r), 0)]);
  const corSit = { novo: 'var(--novo)', and: 'var(--and)', ok: 'var(--ok)', neg: 'var(--neg)' };
  const sit = MODS.demandas.statuses.map(([s, k]) => [s, dem.filter(r => r.status === s).length, corSit[k]]).filter(x => x[1]);
  // documentos
  const docsRows = [
    ...data.servicos.map(r => ({ tipo: r.tipo_doc === 'Indicação' ? 'Indicações' : r.tipo_doc === 'Requerimento' ? 'Requerimentos' : (!r.tipo_doc || r.tipo_doc === 'Ofício') ? 'Ofícios' : null, d: r.data_envio || r.criado_em })),
    ...data.proposituras.map(r => ({ tipo: r.tipo === 'Indicação' ? 'Indicações' : r.tipo === 'Requerimento' ? 'Requerimentos' : 'Projetos, moções e outros', d: r.data_protocolo || r.criado_em })),
  ].filter(x => x.tipo && noPeriodo(x.d, per));
  const tiposDoc = ['Ofícios', 'Indicações', 'Requerimentos', 'Projetos, moções e outros'];
  // equipe
  const equipe = {}; const soma = (nome, k) => { if (!nome) return; (equipe[nome] = equipe[nome] || { dem: 0, conc: 0, of: 0 })[k]++; };
  dem.forEach(r => { soma(r.responsavel, 'dem'); if (r.status === 'Concluída') soma(r.responsavel, 'conc'); });
  data.servicos.filter(r => noPeriodo(r.data_envio || r.criado_em, per)).forEach(r => soma(r.responsavel, 'of'));
  const eqLinhas = Object.entries(equipe).sort((a, b) => (b[1].dem + b[1].of) - (a[1].dem + a[1].of));
  // emendas por ano (exercício)
  const anos = [...new Set(data.emendas.map(r => r.exercicio).filter(Boolean))].sort();
  const emAno = anos.map(a => { const rs = data.emendas.filter(r => String(r.exercicio) === String(a)); return { a, ind: rs.reduce((s, r) => s + (+r.valor_indicado || 0), 0), pago: rs.reduce((s, r) => s + (+r.valor_pago || 0), 0) }; });
  const topEm = Math.max(1, ...emAno.map(x => x.ind));
  const nomePer = g.p === 'livre' ? `de ${per.de ? fmtDataBR(per.de) : 'início'} até ${fmtDataBR(per.ate)}` : PERIODOS.find(x => x[0] === g.p)[1].toLowerCase();
  const kpi = (n, l, sub = '') => `<div class="kpi"><span class="eyebrow">${l}</span><span class="big">${n}</span><span class="sub">${sub || '&nbsp;'}</span></div>`;
  const pnl = (t, corpo, sub = '') => `<section class="panel graf"><h3>${t}${sub ? ` <span class="m" style="font-weight:400">${sub}</span>` : ''}</h3>${corpo}</section>`;
  return `<div class="no-print"><a class="linkbtn" data-go="relatorios">← Relatórios em lista</a></div>
    <h2 class="sec" style="margin-top:6px">Relatórios em gráficos</h2>
    <div class="m">${esc(NOME_GAB())} · ${esc(nomePer)} · gerado em ${fmtStamp(new Date().toISOString())}</div>
    <div class="toolbar no-print" style="margin-top:10px"><div class="chips">${PERIODOS.map(([k, l]) => chip('data-graf-p', k, l, g.p === k)).join('')}${chip('data-graf-p', 'livre', 'Escolher datas', g.p === 'livre')}</div></div>
    ${g.p === 'livre' ? `<div class="filters no-print" style="grid-template-columns:repeat(auto-fit,minmax(150px,200px))"><div class="f"><label for="gf-de">De</label><input id="gf-de" type="date" value="${esc(g.de)}"></div><div class="f"><label for="gf-ate">Até</label><input id="gf-ate" type="date" value="${esc(g.ate)}"></div></div>` : ''}
    <div class="no-print" style="margin:4px 0 12px"><button class="btn primary" id="rel-print">Imprimir / salvar PDF</button></div>
    <div class="kpis">
      ${kpi(dem.length, 'Demandas recebidas')}
      ${kpi(conc.length, 'Concluídas', dem.length ? Math.round(conc.length / dem.length * 100) + '% das recebidas' : '')}
      ${kpi(mediaDias == null ? '—' : (mediaDias < 1 ? '< 1' : Math.round(mediaDias)) + (mediaDias != null && mediaDias >= 1 && Math.round(mediaDias) === 1 ? ' dia' : ' dias'), 'Tempo médio para resolver', tempos.length ? tempos.length + ' demanda(s) concluída(s)' : '')}
      ${kpi(site, 'Pedidos pelo site', dem.length ? Math.round(site / dem.length * 100) + '% das demandas' : '')}
      ${kpi(docsRows.length, 'Documentos enviados', 'ofícios, indicações e outros')}
      ${kpi(media, 'Nota do cidadão', notas.length ? notas.length + ' avaliação(ões)' : 'sem avaliações')}
    </div>
    ${painelVisitas(per, nomePer)}
    ${pnl('Demandas recebidas por mês', grafMeses(porMes(data.demandas, r => r.criado_em)))}
    <div class="cols graf-cols">
      ${pnl('Demandas por situação', grafBarras(sit, { total: dem.length }))}
      ${pnl('Demandas por órgão destinatário', grafBarras(contarPor(dem, r => r.area || 'Sem órgão'), { total: dem.length }))}
      ${pnl('Bairros com mais demandas', grafBarras(contarPor(dem, r => r.bairro ? r.bairro + (r.municipio && r.municipio !== cfg.cidade_gabinete ? ' · ' + r.municipio : '') : ''), { total: dem.length, vazio: 'Nenhuma demanda com bairro no período.' }))}
      ${pnl('Como as demandas chegaram', grafBarras(contarPor(dem, r => r.origem || 'Não informado'), { total: dem.length }))}
    </div>
    ${pnl('Documentos enviados por mês', `<div class="gsm">${tiposDoc.map(t => { const rs = docsRows.filter(x => x.tipo === t); return `<div><div class="gsm-t"><b>${t}</b> <span class="m">${rs.length}</span></div>${grafMeses(porMes(rs, x => x.d), { cor: 'var(--azul)', alto: 90, mini: true })}</div>`; }).join('')}</div>`)}
    <div class="cols graf-cols">
      ${pnl('Atendimentos por colaborador', eqLinhas.length ? `<table class="rtab"><thead><tr><th>Colaborador</th><th class="num">Demandas</th><th class="num">Concluídas</th><th class="num">Ofícios</th></tr></thead><tbody>${eqLinhas.map(([n, v]) => `<tr><td>${esc(n)}</td><td class="num">${v.dem}</td><td class="num">${v.conc}</td><td class="num">${v.of}</td></tr>`).join('')}</tbody></table>` : '<div class="m">Preencha o campo "Responsável no gabinete" nas demandas e ofícios para ver este gráfico.</div>', 'demandas + ofícios')}
      ${pnl('Emendas por ano', emAno.length ? `<div class="gleg"><span><i style="background:var(--accent-soft);border:1px solid var(--accent)"></i>Indicado</span><span><i style="background:var(--accent)"></i>Pago</span></div><div class="gb">${emAno.map(x => `<div class="gb-l" title="${x.a}: indicado ${brl(x.ind)}, pago ${brl(x.pago)}"><span class="gb-k">${x.a}</span><span class="gb-t gb-dupla"><i class="ind" style="width:${(x.ind / topEm * 100).toFixed(1)}%"></i><i class="pago" style="width:${(x.pago / topEm * 100).toFixed(1)}%"></i></span><span class="gb-v num">${brl(x.ind)}<small>pago ${brl(x.pago)}</small></span></div>`).join('')}</div>` : '<div class="m">Preencha o exercício (ano) nas emendas.</div>', 'todos os anos')}
    </div>`;
}

/** Visitas ao site público: carrega uma vez e redesenha. */
function painelVisitas(per, nomePer) {
  const v = state.visitas;
  if (!v || (v.em && Date.now() - v.em > 120000)) { if (!v) state.visitas = { carregando: true }; else v.em = Date.now(); store.listarVisitas().then(rows => { state.visitas = { rows, em: Date.now() }; }).catch(err => { state.visitas = { erro: /visitas|relation|schema cache/i.test(errMsg(err)) ? 'Falta rodar o atualizar-banco.sql no Supabase para contar as visitas.' : errMsg(err) }; }).finally(() => { if (state.view === 'graficos') render(); }); }
  const cab = '<h3>Visitas ao site público <span class="m" style="font-weight:400">' + esc(nomePer) + '</span></h3>';
  if (!v || v.carregando) return `<section class="panel graf">${cab}<div class="m">Carregando…</div></section>`;
  if (v.erro) return `<section class="panel graf">${cab}<div class="m">${esc(v.erro)}</div></section>`;
  const rows = v.rows.filter(r => noPeriodo(r.dia, per));
  const soma = (rs, k) => rs.reduce((a, r) => a + (+r[k] || 0), 0);
  const hoje = v.rows.filter(r => r.dia === todayStr());
  const meses = mesesDoPeriodo(per, v.rows.map(r => r.dia));
  const porMes = meses.map(k => [k, soma(rows.filter(r => r.dia.startsWith(k)), 'visitas')]);
  const dias = []; for (let i = 29; i >= 0; i--) { const d = addDays(todayStr(), -i); dias.push([d, soma(v.rows.filter(r => r.dia === d), 'visitas')]); }
  const topDia = Math.max(1, ...dias.map(x => x[1]));
  const porPag = Object.keys(PAGINAS_VISITA).map(k => [PAGINAS_VISITA[k], soma(rows.filter(r => r.pagina === k), 'visitas')]).filter(x => x[1]).sort((a, b) => b[1] - a[1]);
  const total = soma(rows, 'visitas');
  const kpi = (n, l, sub = '') => `<div class="kpi"><span class="eyebrow">${l}</span><span class="big">${n}</span><span class="sub">${sub || '&nbsp;'}</span></div>`;
  return `<section class="panel graf">${cab}
    <div class="kpis" style="margin-bottom:14px">
      ${kpi(total.toLocaleString('pt-BR'), 'Visitas', 'páginas abertas')}
      ${kpi(soma(rows, 'visitantes').toLocaleString('pt-BR'), 'Pessoas', 'cada uma contada 1 vez por dia')}
      ${kpi(soma(hoje, 'visitas').toLocaleString('pt-BR'), 'Hoje', soma(hoje, 'visitantes') + ' pessoa(s)')}
    </div>
    ${total ? `<div class="cols graf-cols">
      <div><div class="gsm-t"><b>Por mês</b></div>${grafMeses(porMes, { cor: 'var(--azul)', alto: 120 })}</div>
      <div><div class="gsm-t"><b>Últimos 30 dias</b></div><div class="gm" style="--alto:120px">${dias.map(([d, n], i) => `<div class="gm-c" title="${esc(fmtDataBR(d))}: ${n} visita(s)"><span class="gm-b"><i style="height:${(n / topDia * 100).toFixed(1)}%;background:var(--azul)"></i></span><span class="gm-k">${(29 - i) % 7 === 0 ? esc(d.slice(8, 10) + '/' + d.slice(5, 7)) : ''}</span></div>`).join('')}</div></div>
    </div>
    <div style="margin-top:14px"><div class="gsm-t"><b>Páginas mais vistas</b></div>${grafBarras(porPag, { total })}</div>` : '<div class="m">Nenhuma visita registrada no período. A contagem começa a partir de agora.</div>'}
    <div class="m" style="margin-top:8px">Só contamos quantas vezes as páginas abertas ao cidadão foram vistas. Nenhum dado pessoal é guardado.</div>
  </section>`;
}

/* ---------- administração (só o administrador) ---------- */
const dataHora = iso => iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
function haQuanto(iso) {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 2) return 'agora'; if (min < 60) return 'há ' + min + ' min';
  const h = Math.round(min / 60); if (h < 24) return 'há ' + h + ' h';
  const d = Math.round(h / 24); return d === 1 ? 'ontem' : 'há ' + d + ' dias';
}
function renderAdmin() {
  if (!state.admin) return `<h2 class="sec">Administração</h2><div class="empty"><b>Só o administrador do sistema vê esta tela.</b></div>`;
  return `<div class="no-print"><a class="linkbtn" data-go="conta">← Minha conta</a></div>
  <h2 class="sec" style="margin-top:6px">Administração</h2>
  <div class="m">Só você vê esta tela. Os horários estão no horário de Brasília.</div>
  <section class="panel" style="margin-top:14px"><h3>Equipe e últimos acessos</h3>
    <div id="adm-equipe"><div class="m">Carregando…</div></div>
    ${store.configured ? `<form id="eq-add" style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap" novalidate><input id="eq-email" type="email" placeholder="email@exemplo.com" style="flex:1 1 200px;min-width:0;border:1px solid var(--line);background:var(--bg);border-radius:7px;padding:8px 10px"><button class="btn primary" type="submit">Liberar e-mail</button></form>` : ''}
    <p class="m" style="margin-bottom:0">Para liberar alguém: digite o e-mail, toque em <b>Liberar e-mail</b> e peça para a pessoa abrir o sistema e tocar em <b>"Primeiro acesso? Criar minha conta"</b>.</p></section>
  <section class="panel" style="margin-top:14px"><h3>Histórico de acessos</h3>
    <div class="f" style="max-width:320px"><label for="adm-quem">Colaborador</label><select id="adm-quem"><option value="">Todos</option></select></div>
    <div id="adm-hist" style="margin-top:8px"><div class="m">Carregando…</div></div></section>
  <div class="cols" style="margin-top:14px">
    <section class="panel"><h3>Dados do gabinete</h3><p class="m" style="margin-top:0">Aparecem no topo do sistema e nos ofícios e indicações.</p>
      <form id="cfg" class="filters" style="grid-template-columns:1fr;margin:0" novalidate>${CFG_CAMPOS.map(([k, l]) => `<div class="f"><label for="cfg-${k}">${esc(l)}</label><input id="cfg-${k}" value="${esc(cfg[k])}"></div>`).join('')}
      <div><button class="btn primary" type="submit">Salvar dados do gabinete</button></div></form></section>
    <section class="panel"><h3>Modelos de Word</h3><p class="m" style="margin-top:0">Baixe o modelo, mude o que quiser no Word (brasão, fonte, textos) e envie de volta. Os campos entre chaves são preenchidos pelo sistema.</p>
      <div id="modelos-box"><div class="m">Carregando…</div></div>
      <details style="margin-top:10px"><summary class="m" style="cursor:pointer">Campos que você pode usar no modelo</summary><div class="hist"><ol>${docs.CAMPOS.map(([k, l]) => `<li><time>{${k}}</time><span>${esc(l)}</span></li>`).join('')}</ol></div></details></section>
    <section class="panel"><h3>Mensagens prontas do WhatsApp</h3>
      <p class="m" style="margin-top:0">Textos usados nos botões de WhatsApp. Mude o que quiser. Palavras entre chaves são trocadas sozinhas: <b>{nome}</b>, <b>{assunto}</b>, <b>{situacao}</b>, <b>{orgao}</b>, <b>{vereador}</b>, <b>{link_avaliacao}</b>, <b>{protocolo}</b>, <b>{link_consulta}</b>, <b>{evento}</b>, <b>{data}</b>, <b>{hora}</b>, <b>{local}</b>.</p>
      <form id="msgs" class="filters" style="grid-template-columns:1fr;margin:0" novalidate>${Object.entries(MSG_PADRAO).map(([k, [l]]) => `<div class="f"><label for="msg-${k}">${esc(l)}${msgs[k] ? ' <span class="m">(personalizada)</span>' : ''}</label><textarea id="msg-${k}" rows="3">${esc(msgTexto(k))}</textarea></div>`).join('')}
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" type="submit">Salvar mensagens</button><button class="btn ghost" type="button" id="msgs-padrao">Voltar ao texto original</button></div></form></section>
  </div>`;
}
async function carregarAdmin() {
  const box = $('#adm-equipe'); if (!box) return;
  const me = (state.session?.user?.email || '').toLowerCase();
  let us;
  try { us = await store.adminUsuarios(); }
  catch (err) { box.innerHTML = `<div class="err">${esc(/admin_usuarios|function/i.test(errMsg(err)) ? 'Falta rodar o atualizar-banco.sql no Supabase para ver os acessos.' : errMsg(err))}</div>`; us = (await store.listEquipe().catch(() => [])).map(x => ({ ...x })); }
  state.admUsers = us;
  if (us.length) box.innerHTML = `<div class="tab-wrap"><table class="rtab adm"><thead><tr><th>Colaborador</th><th>Último login</th><th>Último uso do sistema</th><th>Acessos (30 dias)</th><th></th></tr></thead><tbody>
    ${us.map(u => `<tr><td><b>${esc(u.nome || u.email)}</b>${u.nome ? `<div class="m">${esc(u.email)}</div>` : ''}${u.admin ? ' <span class="pill k-novo">Administrador</span>' : ''}${u.email === me ? ' <span class="m">(você)</span>' : ''}${!u.conta_criada && 'conta_criada' in u ? '<div class="m" style="color:var(--and)">Ainda não criou a conta</div>' : ''}</td>
      <td>${u.ultimo_login ? `${esc(dataHora(u.ultimo_login))}<div class="m">${esc(haQuanto(u.ultimo_login))}</div>` : '<span class="m">nunca</span>'}</td>
      <td>${u.ultimo_acesso ? `${esc(dataHora(u.ultimo_acesso))}<div class="m">${esc(haQuanto(u.ultimo_acesso))}</div>` : '<span class="m">—</span>'}</td>
      <td class="num">${u.acessos_30d ?? '—'}</td>
      <td>${u.email === me || u.admin ? '' : `<button class="btn mini ghost" data-eq-del="${esc(u.email)}">Remover</button>`}</td></tr>`).join('')}</tbody></table></div>`;
  else if (!box.querySelector('.err')) box.innerHTML = '<div class="m">Nenhum e-mail na lista.</div>';
  const sel = $('#adm-quem'); if (sel && sel.options.length === 1) us.forEach(u => sel.insertAdjacentHTML('beforeend', `<option value="${esc(u.email)}">${esc(u.nome || u.email)}</option>`));
  await carregarHistorico();
}
async function carregarHistorico() {
  const box = $('#adm-hist'); if (!box) return;
  const quem = $('#adm-quem')?.value || '';
  try {
    const l = await store.listarAcessos(quem, 200);
    const nome = em => (state.admUsers || []).find(u => u.email === em)?.nome || em;
    box.innerHTML = l.length ? `<div class="tab-wrap"><table class="rtab"><thead><tr><th>Quando</th><th>Quem</th><th>Aparelho</th></tr></thead><tbody>${l.map(a => `<tr><td>${esc(dataHora(a.em))}</td><td>${esc(nome(a.email))}</td><td>${esc(a.aparelho || '')}</td></tr>`).join('')}</tbody></table></div><p class="m" style="margin-bottom:0">Conta uma vez a cada 10 minutos de uso. Mostrando os últimos ${l.length}.</p>`
      : '<div class="m">Nenhum acesso registrado ainda. Os acessos passam a ser registrados a partir de agora.</div>';
  } catch (err) { box.innerHTML = `<div class="m">${esc(/acessos|relation|schema cache/i.test(errMsg(err)) ? 'Falta rodar o atualizar-banco.sql no Supabase.' : errMsg(err))}</div>`; }
}
function aparelho() {
  const u = navigator.userAgent;
  const tipo = /iPhone|Android.+Mobile|Mobile/i.test(u) ? 'Celular' : /iPad|Tablet|Android/i.test(u) ? 'Tablet' : 'Computador';
  const so = /iPhone|iPad/.test(u) ? 'iPhone' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Mac OS/.test(u) ? 'Mac' : /Linux/.test(u) ? 'Linux' : '';
  return tipo + (so && so !== tipo ? ' · ' + so : '') + (matchMedia('(display-mode: standalone)').matches ? ' · app' : '');
}

/* ---------- agenda ligada ao Gmail e outras agendas ---------- */
state.ext = { lista: [], em: 0, carregando: false, erro: '' };
state.agLink = null;
state.agForm = { cor: ags.CORES[0] };
function carregarExternas(force) {
  const x = state.ext;
  if (!store.configured || x.carregando || (!force && x.em && Date.now() - x.em < 600000) || (!force && x.erro && Date.now() - x.em < 120000)) return;
  x.carregando = true;
  store.agendaFn('eventos').then(r => { x.lista = r.agendas || []; x.erro = ''; })
    .catch(err => { x.erro = errMsg(err); })
    .finally(() => { x.carregando = false; x.em = Date.now(); if (['agenda', 'painel', 'agendas'].includes(state.view) && !drawer.open) render(); });
}
function extEventos() {
  const out = [];
  for (const g of state.ext.lista) for (const e of g.eventos || []) out.push({ ...e, id: e.uid, ext: true, agenda: g.nome, cor: g.cor });
  return out;
}
function extFiltrados() {
  const t = todayStr(); const q = state.q.trim().toLowerCase();
  return extEventos().filter(r => (state.agendaWin === 'proximos' ? r.data >= t : state.agendaWin === 'passados' ? r.data < t : true) && (!q || (r.titulo + ' ' + (r.local || '') + ' ' + r.agenda).toLowerCase().includes(q)));
}
const extTitulo = r => `${r.titulo} · ${fmtDate(r.data)}${r.inicio ? ' às ' + hhmm(r.inicio) : ''}${r.local ? ' · ' + r.local : ''} — da agenda "${r.agenda}". Para mudar, mude lá.`;
function extResumo() {
  const x = state.ext; const l = x.lista; const comErro = l.filter(g => g.erro).length;
  if (!l.length && x.carregando) return 'Carregando outras agendas…';
  if (!l.length) return 'Veja aqui os compromissos do Gmail e veja os daqui no Gmail e no celular.';
  return `${l.length} outra(s) agenda(s) aparecendo aqui: ${l.map(g => `<span class="ext-dot" style="--cor:${esc(g.cor)}"></span>${esc(g.nome)}`).join(', ')}${comErro ? ` · <b class="ext-erro">⚠ ${comErro} com problema</b>` : ''}`;
}
function carregarLinkAgenda(force) {
  if (!store.configured || (state.agLink && !force && !state.agLink.erro)) return;
  state.agLink = { carregando: true };
  store.agendaFn('link').then(r => { state.agLink = { url: r.url }; }).catch(err => { state.agLink = { erro: errMsg(err) }; }).finally(() => { if (state.view === 'agendas') render(); });
}
function renderAgendas() {
  if (!store.configured) return `${banner()}<h2 class="sec">Ligar com Gmail e outras agendas</h2><div class="empty"><b>Precisa do banco de dados ligado</b>Esta função usa o servidor do sistema.</div>`;
  carregarLinkAgenda(); carregarExternas();
  const L = state.agLink || { carregando: true }; const x = state.ext;
  const sec1 = L.url ? `
      <div class="ag-botoes">
        <a class="btn primary" href="${esc(ags.linkAssinarGoogle(L.url))}" target="_blank" rel="noopener">Adicionar no Google Agenda (Gmail)</a>
        <a class="btn" href="${esc(ags.linkWebcal(L.url))}">iPhone / Mac</a>
        <a class="btn" href="${esc(ags.linkAssinarOutlook(L.url))}" target="_blank" rel="noopener">Outlook</a>
      </div>
      <ol class="ag-passos">
        <li>Entre com o <b>Gmail do gabinete</b> (ou o seu) e clique no botão <b>Adicionar no Google Agenda</b> acima.</li>
        <li>O Google pergunta <i>"Adicionar agenda?"</i>: clique em <b>Adicionar</b>.</li>
        <li>Pronto. A "Agenda do gabinete (Fala Cascavel)" aparece no Google Agenda e no celular. O Google atualiza sozinho, de algumas em algumas horas.</li>
      </ol>
      <div class="f"><label for="ag-link">Link da agenda (para outros aplicativos)</label><input id="ag-link" value="${esc(L.url)}" readonly></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn mini" type="button" data-ag-copiar>Copiar link</button>${state.admin ? '<button class="btn mini ghost" type="button" data-ag-trocar>Trocar link</button>' : ''}</div>
      <p class="m">Quem tiver este link vê os compromissos. Mande só para a equipe.${state.admin ? ' Se vazar, use "Trocar link": o antigo para de funcionar.' : ''}</p>`
    : L.erro ? `<div class="aviso-contatos"><span class="m">Não foi possível pegar o link: ${esc(L.erro)}</span> <button class="btn mini" type="button" data-ag-retentar>Tentar de novo</button></div>`
    : '<p class="m">Preparando o link…</p>';
  const lista = x.lista.length ? x.lista.map(g => `<div class="ag-ext"><span class="ext-dot" style="--cor:${esc(g.cor)}"></span><div style="min-width:0;flex:1"><b>${esc(g.nome)}</b><div class="m">${g.erro ? `<span class="ext-erro">⚠ ${esc(g.erro)}</span>` : `${(g.eventos || []).length} compromisso(s) lidos`}</div></div><button class="btn mini ghost" type="button" data-ag-rem="${esc(g.id)}">Remover</button></div>`).join('')
    : x.carregando ? '<p class="m">Carregando…</p>' : x.erro ? `<p class="m ext-erro">⚠ ${esc(x.erro)}</p>` : '<p class="m">Nenhuma agenda ligada ainda.</p>';
  return `${banner()}<div class="no-print"><a class="linkbtn" data-go="agenda">← Agenda</a></div>
    <h2 class="sec" style="margin-top:6px">Ligar com Gmail e outras agendas</h2>
    <div class="m">Duas mãos: os compromissos daqui aparecem no Gmail/celular, e os do Gmail (ou Outlook, iPhone) aparecem aqui.</div>
    <div class="cols" style="margin-top:14px">
      <section class="panel"><h3>1. Ver a agenda do sistema no Gmail e no celular</h3>${sec1}</section>
      <section class="panel"><h3>2. Mostrar aqui outras agendas</h3>
        <p class="m" style="margin-top:0">Os compromissos do Gmail, Outlook ou iPhone aparecem na Agenda do sistema, com a cor escolhida. Ficam só para ver: para mudar, mude na agenda de origem.</p>
        <div class="ag-lista">${lista}</div>
        <form id="ag-form" class="filters" style="grid-template-columns:1fr;margin:12px 0 0" novalidate>
          <div class="f"><label for="ag-nome">Nome</label><input id="ag-nome" placeholder="Ex.: Gmail do vereador" maxlength="60" autocomplete="off"></div>
          <div class="f"><label for="ag-url">Link da agenda (endereço iCal)</label><input id="ag-url" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" autocomplete="off" inputmode="url"></div>
          <div class="f"><label>Cor</label><div class="ag-cores">${ags.CORES.map(c => `<button type="button" class="ag-cor" style="--cor:${c}" data-ag-cor="${c}" aria-pressed="${state.agForm.cor === c}" aria-label="Cor ${c}"></button>`).join('')}</div></div>
          <div><button class="btn primary" type="submit" id="ag-add">Ligar esta agenda</button></div>
        </form>
        <details class="ag-ajuda" open><summary>Onde pego o link do Gmail (Google Agenda)?</summary><ol>
          <li>No computador, abra <a href="https://calendar.google.com/calendar/r/settings" target="_blank" rel="noopener">as configurações do Google Agenda</a> com o Gmail da agenda.</li>
          <li>Na coluna da esquerda, em <i>Configurações das minhas agendas</i>, clique no nome da agenda.</li>
          <li>Desça até <i>Integrar agenda</i> e copie o <b>Endereço secreto no formato iCal</b> (termina em <code>basic.ics</code>).</li>
          <li>Cole no campo <b>Link</b> acima, dê um nome e clique em <b>Ligar esta agenda</b>.</li></ol></details>
        <details class="ag-ajuda"><summary>E do Outlook / Hotmail?</summary><ol>
          <li>Em outlook.com, vá em ⚙ Configurações → Calendário → <i>Calendários compartilhados</i>.</li>
          <li>Em <i>Publicar um calendário</i>, escolha o calendário e <i>Pode exibir todos os detalhes</i> → Publicar.</li>
          <li>Copie o link <b>ICS</b> e cole aqui.</li></ol></details>
        <details class="ag-ajuda"><summary>E do iPhone (iCloud)?</summary><ol>
          <li>No iPhone, abra o app Calendário → <i>Calendários</i> → toque no ⓘ ao lado da agenda.</li>
          <li>Ligue <i>Calendário Público</i> e toque em <i>Compartilhar Link</i> → Copiar.</li>
          <li>Cole aqui (o link começa com webcal://, pode colar assim mesmo).</li></ol></details>
      </section>
    </div>`;
}
async function salvarAgendasExternas(mudar) {
  const cfg = await store.getConfig('agendas_externas');
  const lista = mudar((cfg?.lista || []).slice());
  await store.agendaFn('salvar', { agendas: lista });
  carregarExternas(true);
}
async function ligarAgenda() {
  const nome = ($('#ag-nome')?.value || '').trim(); const url = ($('#ag-url')?.value || '').trim();
  if (!url) { toast('Cole o link da agenda'); $('#ag-url')?.focus(); return; }
  if (!/^(https|webcals?):\/\//i.test(url)) { toast('O link precisa começar com https:// ou webcal://'); return; }
  const btn = $('#ag-add'); if (btn) { btn.disabled = true; btn.textContent = 'Conferindo o link…'; }
  try {
    const t = await store.agendaFn('testar', { url });
    await salvarAgendasExternas(l => l.concat({ id: Date.now().toString(36), nome: nome || t.nome || 'Outra agenda', url, cor: state.agForm.cor }));
    toast(`Agenda ligada: ${t.total} compromisso(s) encontrados`);
    state.agForm.cor = ags.CORES[(ags.CORES.indexOf(state.agForm.cor) + 1) % ags.CORES.length];
    render();
  } catch (err) { toast(errMsg(err)); if (btn) { btn.disabled = false; btn.textContent = 'Ligar esta agenda'; } }
}
function agendasClique(e) {
  if (e.target.closest('[data-ag-copiar]')) { const i = $('#ag-link'); try { navigator.clipboard.writeText(i.value).then(() => toast('Link copiado')); } catch { i.select(); document.execCommand('copy'); toast('Link copiado'); } return true; }
  if (e.target.closest('[data-ag-retentar]')) { carregarLinkAgenda(true); render(); return true; }
  if (e.target.closest('[data-ag-trocar]')) {
    if (!confirm('Trocar o link? Quem já adicionou a agenda no Google ou no celular vai precisar adicionar de novo.')) return true;
    store.agendaFn('novo-link').then(r => { state.agLink = { url: r.url }; render(); toast('Link novo criado. Adicione de novo no Google Agenda.'); }).catch(err => toast(errMsg(err)));
    return true;
  }
  const c = e.target.closest('[data-ag-cor]'); if (c) { state.agForm.cor = c.dataset.agCor; document.querySelectorAll('[data-ag-cor]').forEach(b => b.setAttribute('aria-pressed', b === c)); return true; }
  const rm = e.target.closest('[data-ag-rem]'); if (rm) {
    const id = rm.dataset.agRem; const g = state.ext.lista.find(x => x.id === id);
    if (!confirm(`Tirar a agenda "${g?.nome || ''}" do sistema? (Nada é apagado no Gmail.)`)) return true;
    rm.disabled = true;
    salvarAgendasExternas(l => l.filter(x => x.id !== id)).then(() => { state.ext.lista = state.ext.lista.filter(x => x.id !== id); render(); toast('Agenda removida'); }).catch(err => { toast(errMsg(err)); rm.disabled = false; });
    return true;
  }
  return false;
}

/* ---------- calendário do mês (agenda) ---------- */
function calendarioHtml() {
  const t = todayStr(); const ym = state.cal || t.slice(0, 7); const [y, mo] = ym.split('-').map(Number);
  const ini = new Date(y, mo - 1, 1); const vazio = ini.getDay(); const dias = new Date(y, mo, 0).getDate();
  const q = state.q.trim().toLowerCase();
  const ev = data.agenda.filter(r => r.data && r.data.startsWith(ym) && (!q || Object.values(r).some(v => typeof v === 'string' && v.toLowerCase().includes(q)))).sort((a, b) => (a.data + hhmm(a.inicio)).localeCompare(b.data + hhmm(b.inicio)));
  const evx = extEventos().filter(r => r.data.startsWith(ym) && (!q || (r.titulo + ' ' + (r.local || '') + ' ' + r.agenda).toLowerCase().includes(q)));
  let cel = '';
  for (let i = 0; i < vazio; i++) cel += '<div class="cal-d fora"></div>';
  for (let d = 1; d <= dias; d++) {
    const dia = ym + '-' + pad(d); const es = ev.filter(r => r.data === dia).concat(evx.filter(r => r.data === dia)).sort((a, b) => hhmm(a.inicio).localeCompare(hhmm(b.inicio)));
    cel += `<div class="cal-d ${dia === t ? 'hoje' : ''}" data-cal-dia="${dia}" title="Novo compromisso em ${fmtDate(dia)}"><span class="cal-n">${d}</span>${es.slice(0, 3).map(r => r.ext ? `<span class="cal-ev ext" style="--cor:${esc(r.cor)}" data-ext="${esc(extTitulo(r))}" title="${esc(extTitulo(r))}">${r.inicio ? `<b>${esc(hhmm(r.inicio))}</b> ` : ''}${esc(r.titulo)}</span>` : `<button class="cal-ev ${r.status === 'Cancelado' ? 'cancel' : ''}" data-open="agenda:${r.id}" title="${esc(r.titulo)}">${r.inicio ? `<b>${esc(hhmm(r.inicio))}</b> ` : ''}${esc(r.titulo)}</button>`).join('')}${es.length > 3 ? `<span class="cal-mais">+${es.length - 3}</span>` : ''}</div>`;
  }
  return `<div class="cal"><div class="cal-top"><button class="btn mini" data-cal-nav="-1" aria-label="Mês anterior">‹</button><b>${MESES[mo - 1].replace(/^./, c => c.toUpperCase())} de ${y}</b><button class="btn mini" data-cal-nav="1" aria-label="Próximo mês">›</button>${ym !== t.slice(0, 7) ? '<button class="btn mini ghost" data-cal-nav="0">Hoje</button>' : ''}<span class="m" style="margin-left:auto">${ev.length} compromisso(s)${evx.length ? ' + ' + evx.length + ' de outras agendas' : ''} · toque num dia para marcar</span></div>
    <div class="cal-g">${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => `<div class="cal-h">${d}</div>`).join('')}${cel}</div></div>`;
}

/* ---------- roteiro de visitas (mapa) ---------- */
function ordenarRota(l) {
  if (l.length < 3) return l.slice();
  const dist = (a, b) => Math.hypot(a.lat - b.lat, (a.lng - b.lng) * Math.cos(a.lat * Math.PI / 180));
  const resto = l.slice(1), out = [l[0]];
  while (resto.length) { const u = out[out.length - 1]; let k = 0; resto.forEach((p, i) => { if (dist(u, p) < dist(u, resto[k])) k = i; }); out.push(resto.splice(k, 1)[0]); }
  return out;
}
function linkRota(l) {
  const c = p => (+p.lat).toFixed(6) + ',' + (+p.lng).toFixed(6);
  const dest = l[l.length - 1], meio = l.slice(0, -1);
  return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + c(dest) + (meio.length ? '&waypoints=' + encodeURIComponent(meio.map(c).join('|')) : '');
}
function rotaHtml() {
  const l = state.rota;
  if (!l.length) return '';
  return `<section class="panel rota"><h3>Roteiro de visitas <span class="m" style="font-weight:400">${l.length} parada(s)</span></h3>
    <ol class="rota-l">${l.map((p, i) => `<li><span>${esc(p.titulo)}</span><button class="btn mini ghost" data-rota-del="${i}" aria-label="Tirar do roteiro">✕</button></li>`).join('')}</ol>
    <div style="display:flex;gap:8px;flex-wrap:wrap">${l.length > 2 ? '<button class="btn mini" data-rota-ordenar>Ordenar pelo caminho mais curto</button>' : ''}<a class="btn mini primary" href="${esc(linkRota(l))}" target="_blank" rel="noopener">Abrir rota no Google Maps</a><button class="btn mini ghost" data-rota-limpar>Limpar</button></div>
    <p class="m" style="margin-bottom:0">A rota começa onde você estiver e passa pelas paradas nessa ordem.</p></section>`;
}
function atualizarRota() { const b = $('#rota-box'); if (b) b.innerHTML = rotaHtml(); }

/* ---------- disparo em sequência pelo WhatsApp ---------- */
function iniciarDisparo(titulo, lista, texto) {
  const vistos = new Set();
  lista = lista.filter(p => { const k = String(p.telefone).replace(/\D/g, ''); if (!k || vistos.has(k)) return false; vistos.add(k); return true; });
  state.disp = { titulo, lista, texto, i: 0, feitos: [] };
  closeDrawer(); go('disparo');
}
function avancarDisparo(enviado) {
  const d = state.disp; if (!d) return;
  if (enviado) d.feitos.push(d.i);
  d.i++; render();
}
function renderDisparo() {
  const d = state.disp;
  if (!d) return `<div class="no-print"><a class="linkbtn" data-go="pessoas">← Pessoas</a></div><h2 class="sec">Envio em sequência</h2><div class="empty"><b>Nada para enviar</b>Comece em Pessoas → “Mensagem para esta lista”, no Painel → aniversariantes, ou num compromisso da Agenda → “Convidar pessoas”.</div>`;
  const p = d.lista[d.i]; const fim = !p;
  const txt = p ? preencher(d.texto, { nome: primeiroNome(p.nome), vereador: DEP() }) : '';
  const wa = p ? waLink(p.telefone, txt) : '';
  return `<div class="no-print"><a class="linkbtn" data-go="pessoas">← Pessoas</a></div>
    <h2 class="sec" style="margin-top:6px">${esc(d.titulo)}</h2>
    <div class="m">Você manda uma por uma: toque no botão verde, envie no WhatsApp e volte aqui para a próxima. Assim o WhatsApp não bloqueia o número.</div>
    <div class="cols" style="margin-top:14px">
      <section class="panel"><h3>Mensagem</h3>
        <div class="f"><label for="disp-texto">Texto (use {nome} para o primeiro nome)</label><textarea id="disp-texto" rows="6">${esc(d.texto)}</textarea></div>
        ${p ? `<div class="m" style="margin-top:8px">Como vai chegar para ${esc(primeiroNome(p.nome))}:</div><div class="disp-prev">${esc(txt)}</div>` : ''}</section>
      <section class="panel"><h3>Envio <span class="m" style="font-weight:400">${Math.min(d.i, d.lista.length)} de ${d.lista.length} · ${d.feitos.length} enviada(s)</span></h3>
        <div class="barra-mini"><i style="width:${d.lista.length ? (Math.min(d.i, d.lista.length) / d.lista.length * 100).toFixed(1) : 0}%"></i></div>
        ${fim ? `<div class="empty" style="margin-top:10px"><b>${d.lista.length ? 'Lista concluída!' : 'Ninguém com telefone nessa lista'}</b>${d.feitos.length} mensagem(ns) aberta(s) no WhatsApp.</div><button class="btn" data-disp-reiniciar>Começar de novo</button>`
          : `<div style="margin:12px 0 6px"><b>${esc(p.nome)}</b> <span class="m">${esc(p.telefone)}</span></div>
             ${wa ? `<a class="btn wa disp-btn" href="${esc(wa)}" target="_blank" rel="noopener" data-disp-enviar>Abrir WhatsApp de ${esc(primeiroNome(p.nome))} (${d.i + 1} de ${d.lista.length})</a>` : '<div class="m">Telefone inválido.</div>'}
             <button class="btn ghost" data-disp-pular style="margin-top:8px">Pular esta pessoa</button>`}
        <details style="margin-top:12px"><summary class="m" style="cursor:pointer">Ver a lista (${d.lista.length})</summary><ol class="disp-l">${d.lista.map((x, i) => `<li class="${d.feitos.includes(i) ? 'ok' : i < d.i ? 'pulou' : i === d.i ? 'agora' : ''}">${esc(x.nome)}</li>`).join('')}</ol></details></section>
    </div>`;
}

/* ---------- consulta do protocolo (página aberta ao cidadão) ---------- */
function renderConsulta(prot = '', msgErro = '', tel = '', res = null) {
  document.title = 'Fala Cascavel · Acompanhe seu pedido';
  const sit = res ? (kindOf('demandas', res.status) || 'novo') : '';
  const frase = { novo: 'Recebemos o seu pedido e ele vai ser analisado pela equipe.', and: 'O gabinete está trabalhando no seu pedido.', ok: 'Seu pedido foi concluído!', neg: 'Este pedido foi arquivado. Fale com o gabinete se precisar.' }[sit] || '';
  document.body.innerHTML = `<div class="login portal">${topoPortal('pedido')}<div class="login-card pub">
    ${marcaPub()}
    ${tituloPortal('Acompanhe seu pedido')}
    ${res ? `<div class="consulta-res">
        <div class="m">Protocolo <b class="num">${esc(res.protocolo)}</b></div>
        <div class="t" style="font-weight:700;font-size:16px">${esc(res.assunto || '')}</div>
        <div><span class="pill ${STATUS_KIND[sit] || ''}">${esc(res.status)}</span></div>
        <p class="m" style="margin:0">${esc(frase)}</p>
        <div class="m">Aberto em ${esc(fmtDate(String(res.aberto_em).slice(0, 10)))}${res.atualizado_em ? ' · última atualização em ' + esc(fmtDate(String(res.atualizado_em).slice(0, 10))) : ''}</div>
        ${(res.linha || []).length ? `<ol class="consulta-linha">${res.linha.map(h => `<li><time>${esc(fmtDate(String(h.em).slice(0, 10)))}</time> ${esc(h.txt)}</li>`).join('')}</ol>` : ''}
      </div><button class="btn" id="cs-outra" type="button" style="justify-content:center">Consultar outro protocolo</button>`
    : `<p class="pt-sub">Digite o número do protocolo que você recebeu e o celular informado no pedido.</p>
      <form id="fcons" style="display:flex;flex-direction:column;gap:12px" novalidate>
        <div class="f"><label for="cs-prot">Número do protocolo</label><input id="cs-prot" autocomplete="off" placeholder="Ex.: 2026-000123" maxlength="20" value="${esc(prot)}" style="text-transform:uppercase"></div>
        <div class="f"><label for="cs-tel">Seu celular</label><input id="cs-tel" type="tel" inputmode="numeric" autocomplete="tel" maxlength="20" placeholder="(45) 99999-9999" value="${esc(mascaraTel(tel))}"></div>
        ${msgErro ? `<div class="err">${esc(msgErro)}</div>` : ''}
        <button class="btn primary" type="submit" style="justify-content:center">Consultar</button>
      </form>`}
    <div class="m" style="font-size:11.5px">Ainda não fez seu pedido? <a href="${esc(linkPublico())}">Faça aqui</a>.</div></div></div>`;
  const o = $('#cs-outra'); if (o) o.addEventListener('click', () => renderConsulta());
  const f = $('#fcons'); if (!f) return;
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const p = $('#cs-prot').value.trim().toUpperCase(), t = $('#cs-tel').value;
    if (!p || digitosTel(t).length < 10) return renderConsulta(p, 'Digite o protocolo e o celular com DDD.', t);
    const b = f.querySelector('[type=submit]'); b.disabled = true; b.textContent = 'Consultando…';
    try { const r = await store.consultarProtocolo(p, t); if (!r) return renderConsulta(p, 'Não encontramos um pedido com esse protocolo e esse celular. Confira os números.', t); renderConsulta(p, '', t, r); }
    catch (err) { renderConsulta(p, errMsg(err), t); }
  });
}

/* ---------- pesquisa de satisfação (página aberta ao cidadão) ---------- */
async function renderAvaliacao(token) {
  document.title = 'Fala Cascavel · Avaliação';
  const caixa = h => { document.body.innerHTML = `<div class="login portal">${topoPortal()}<div class="login-card pub av">${h}</div></div>`; };
  caixa('<div class="m" style="text-align:center">Carregando…</div>');
  let info;
  try { info = /^[0-9a-f-]{36}$/i.test(token) || !store.configured ? await store.avaliacaoInfo(token) : null; }
  catch (e) { caixa(`<b>Página indisponível no momento.</b><p class="m">${esc(errMsg(e))}</p>`); return; }
  const g = info?.gabinete || {}; if (g.gabinete) cfg.gabinete = g.gabinete; if (g.deputado_nome) cfg.deputado_nome = g.deputado_nome; if (g.deputado_cargo) cfg.deputado_cargo = g.deputado_cargo;
  const obrigado = `<div style="text-align:center"><div style="font-size:44px">🇧🇷</div><h2 class="sec">Obrigado pela sua avaliação!</h2><p class="m">Sua opinião ajuda o gabinete do ${esc(DEP())} a trabalhar cada vez melhor.</p></div>`;
  if (!info) { caixa('<b>Link de avaliação não encontrado.</b><p class="m">Confira se o link foi copiado inteiro.</p>'); return; }
  if (info.nota != null) { caixa(obrigado); return; }
  let nota = 0;
  caixa(`<div class="eyebrow">Gabinete do ${esc(DEP())}</div><h2 class="sec" style="margin-top:4px">Como foi o atendimento?</h2>
    <p class="m">Pedido: <b>${esc(info.assunto || '')}</b></p>
    <div class="av-est" role="radiogroup" aria-label="Nota de 1 a 5">${[1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" aria-checked="false" data-nota="${n}" aria-label="${n} de 5">★</button>`).join('')}</div>
    <div class="m" id="av-rot" style="text-align:center;min-height:18px"></div>
    <div class="f" style="margin-top:10px"><label for="av-com">Quer deixar um comentário? (opcional)</label><textarea id="av-com" rows="3" maxlength="1000"></textarea></div>
    <div class="err" id="av-err" hidden></div>
    <button class="btn primary" id="av-env" style="width:100%;margin-top:12px" disabled>Enviar avaliação</button>`);
  const rot = ['', 'Muito ruim', 'Ruim', 'Regular', 'Bom', 'Ótimo'];
  document.querySelectorAll('[data-nota]').forEach(b => b.addEventListener('click', () => {
    nota = +b.dataset.nota; $('#av-rot').textContent = rot[nota]; $('#av-env').disabled = false;
    document.querySelectorAll('[data-nota]').forEach(x => { x.classList.toggle('on', +x.dataset.nota <= nota); x.setAttribute('aria-checked', String(+x.dataset.nota === nota)); });
  }));
  $('#av-env').addEventListener('click', async () => {
    const b = $('#av-env'); b.disabled = true; b.textContent = 'Enviando…';
    try { await store.avaliar(token, nota, $('#av-com').value.trim()); caixa(obrigado); }
    catch (e) { const er = $('#av-err'); er.hidden = false; er.textContent = 'Não foi possível enviar: ' + errMsg(e); b.disabled = false; b.textContent = 'Enviar avaliação'; }
  });
}

async function renderPrestacao() {
  document.body.innerHTML = `<div class="pub-page portal">${topoPortal()}<div class="m" style="padding:40px;text-align:center">Carregando…</div></div>`;
  let d;
  try { d = await store.prestacaoPublica(); }
  catch (e) { document.body.innerHTML = `<div class="pub-page portal">${topoPortal()}<div class="empty" style="margin:40px auto;max-width:480px"><b>Página indisponível no momento</b>${esc(errMsg(e))}</div></div>`; return; }
  const g = d.gabinete || {}; if (g.gabinete) cfg.gabinete = g.gabinete; if (g.deputado_nome) cfg.deputado_nome = g.deputado_nome; if (g.deputado_cargo) cfg.deputado_cargo = g.deputado_cargo;
  document.title = 'Fala Cascavel · Prestação de contas';
  const pub = { f: { area: '', bairro: '' } };
  const desenha = () => {
    const f = pub.f;
    const dem = d.demandas.filter(x => (!f.area || x.area === f.area) && (!f.bairro || x.bairro === f.bairro));
    const ofs = f.area || f.bairro ? [] : d.servicos;
    const ems = d.emendas.filter(x => !f.area || x.area === f.area);
    const totEm = ems.reduce((s, x) => s + (+x.valor || 0), 0);
    const bairros = new Set(d.demandas.map(x => x.bairro).filter(Boolean));
    const areas = [...new Set([...d.demandas, ...d.emendas].map(x => x.area).filter(Boolean))].sort();
    const ico = a => ({ Obras: '🏗️', Infraestrutura: '🛣️', 'Iluminação pública': '💡', Trânsito: '🚦', 'Meio ambiente': '🌳', Saúde: '🏥', Educação: '🏫', 'Assistência social': '🤝', Segurança: '🛡️', Esporte: '⚽', 'Esporte e cultura': '⚽', Cultura: '🎭', Agricultura: '🌾' }[a] || '✅');
    const card = (t, sub, a, extra = '') => `<article class="pub-card"><span class="pub-ico">${ico(a)}</span><div><b>${esc(t)}</b><div class="m">${esc(sub)}</div>${extra}</div></article>`;
    const texto = `Prestação de contas do ${DEP()}: ${d.demandas.length + d.servicos.length} pedidos atendidos${totEm ? ' e ' + brl(totEm) + ' em emendas' : ''}. Confira: ${linkPrestacao()}`;
    document.body.innerHTML = `<div class="pub-page portal">${topoPortal('pedido')}
      <header class="pub-hero"><div class="pub-wrap">
        ${marcaPub()}
        <h1>Trabalho que chega ao bairro</h1><p>Obras, serviços e emendas conquistados pelo mandato do ${esc(DEP())}.</p>
        <div class="pub-nums"><div><b>${d.demandas.length}</b><span>pedidos da população atendidos</span></div><div><b>${d.servicos.length}</b><span>ofícios atendidos</span></div><div><b>${bairros.size}</b><span>bairros e localidades</span></div><div><b>${brl(d.emendas.reduce((s, x) => s + (+x.valor || 0), 0))}</b><span>em emendas</span></div></div>
        <div class="pub-share no-print"><a class="btn wa" href="https://wa.me/?text=${encodeURIComponent(texto)}" target="_blank" rel="noopener">Compartilhar no WhatsApp</a><a class="btn" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(linkPrestacao())}" target="_blank" rel="noopener">Facebook</a><button class="btn" id="pub-copiar-link" type="button">Copiar link</button></div>
      </div></header>
      <main class="pub-wrap">
        <div class="filters no-print" style="margin-top:18px"><div class="f"><label for="pf-area">Área</label><select id="pf-area"><option value="">Todas</option>${areas.map(a => `<option ${a === f.area ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></div>
          <div class="f"><label for="pf-bairro">Bairro</label><select id="pf-bairro"><option value="">Todos</option>${[...bairros].sort((a, b) => a.localeCompare(b, 'pt-BR')).map(a => `<option ${a === f.bairro ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></div></div>
        ${dem.length ? `<h2 class="sec">Pedidos atendidos</h2><div class="pub-grid">${dem.map(x => card(x.titulo, [x.bairro, x.municipio, x.data && fmtDataBR(x.data)].filter(Boolean).join(' · '), x.area)).join('')}</div>` : ''}
        ${ofs.length ? `<h2 class="sec">Ofícios atendidos pelos órgãos</h2><div class="pub-grid">${ofs.map(x => card(x.titulo, [x.orgao, x.municipio, x.data && fmtDataBR(x.data)].filter(Boolean).join(' · '), 'Obras')).join('')}</div>` : ''}
        ${ems.length ? `<h2 class="sec">Emendas destinadas</h2><div class="pub-grid">${ems.map(x => card(x.titulo, [x.beneficiario, x.municipio, x.exercicio].filter(Boolean).join(' · '), x.area, `<div class="pub-valor">${brl(x.valor)} <span class="pill ${x.status === 'Paga' ? 'k-ok' : 'k-and'}">${esc(x.status === 'Paga' ? 'Paga' : x.status === 'Empenhada' ? 'Empenhada' : 'Indicada')}</span></div>`)).join('')}</div>` : ''}
        ${!dem.length && !ofs.length && !ems.length ? '<div class="empty" style="margin-top:20px"><b>Em breve</b>Os resultados do mandato aparecerão aqui.</div>' : ''}
        <footer class="pub-foot m">${esc(NOME_GAB())} · atualizado em ${fmtStamp(new Date().toISOString())}</footer>
      </main></div>`;
    $('#pf-area')?.addEventListener('change', e => { f.area = e.target.value; desenha(); });
    $('#pf-bairro')?.addEventListener('change', e => { f.bairro = e.target.value; desenha(); });
    $('#pub-copiar-link')?.addEventListener('click', () => { try { navigator.clipboard.writeText(linkPrestacao()).then(() => toast('Link copiado')); } catch { toast(linkPrestacao()); } });
  };
  desenha();
}

/* ---------- eventos ---------- */
document.addEventListener('click', e => {
  const bt = e.target.closest('#btn-tema');
  if (bt) { const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'; document.documentElement.dataset.theme = t; try { localStorage.setItem('fc-tema', t); } catch { /* ok */ } bt.textContent = t === 'light' ? '🌙' : '☀️'; return; }
  if (e.target.closest('[data-stop]')) { e.stopPropagation(); return; }
  const g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); go(g.dataset.go); return; }
  const o = e.target.closest('[data-open]'); if (o) { const [m, id] = o.dataset.open.split(':'); openDrawer(m, id); return; }
  if (e.target.closest('[data-close]')) { closeDrawer(); return; }
  const f = e.target.closest('[data-filter]'); if (f) { state.filter = f.dataset.filter; render(); return; }
  const w = e.target.closest('[data-win]'); if (w) { state.agendaWin = w.dataset.win; render(); return; }
  const nf = e.target.closest('[data-new-for]'); if (nf) { const p = data.pessoas.find(x => x.id === drawer.id); closeDrawer(); go(nf.dataset.newFor); openDrawer(nf.dataset.newFor, null, { solicitante: p?.nome, telefone: p?.telefone, municipio: p?.municipio, bairro: p?.bairro }); return; }
  const sr = e.target.closest('[data-search]'); if (sr) { const q = sr.dataset.search; closeDrawer(); go('demandas'); state.q = q; state.filter = 'todos'; render(); return; }
  if (e.target.closest('[data-oficio-de]')) { oficioDaDemanda(); return; }
  const gp = e.target.closest('[data-graf-p]'); if (gp) { state.graf.p = gp.dataset.grafP; render(); return; }
  const xe = e.target.closest('[data-ext]'); if (xe) { toast(xe.dataset.ext); return; }
  if (agendasClique(e)) return;
  const cd = e.target.closest('[data-cal-dia]'); if (cd) { openDrawer('agenda', null, { data: cd.dataset.calDia }); return; }
  const cn = e.target.closest('[data-cal-nav]'); if (cn) { const [y, mo] = (state.cal || todayStr().slice(0, 7)).split('-').map(Number); const n = +cn.dataset.calNav; state.cal = n === 0 ? '' : ymd(new Date(y, mo - 1 + n, 1)).slice(0, 7); render(); return; }
  const rdel = e.target.closest('[data-rota-del]'); if (rdel) { state.rota.splice(+rdel.dataset.rotaDel, 1); atualizarRota(); return; }
  if (e.target.closest('[data-rota-ordenar]')) { state.rota = ordenarRota(state.rota); atualizarRota(); toast('Paradas em ordem pelo caminho mais curto'); return; }
  if (e.target.closest('[data-rota-limpar]')) { state.rota = []; atualizarRota(); return; }
  if (e.target.closest('[data-disp-aniv]')) { const md = s => s.slice(5); const t = todayStr(); iniciarDisparo('Parabéns aos aniversariantes de hoje', data.pessoas.filter(p => p.status !== 'Inativo' && p.telefone && p.nascimento && md(p.nascimento) === md(t)), msgTexto('aniversario')); return; }
  if (e.target.closest('[data-disp-lista]')) { iniciarDisparo('Mensagem para a lista de pessoas', filtered('pessoas').filter(p => p.telefone), msgTexto('contato')); return; }
  if (e.target.closest('[data-disp-convite]')) { const r = data.agenda.find(x => x.id === drawer.id); closeDrawer(); const v = { evento: r.titulo, data: fmtDate(r.data), hora: r.inicio ? ', às ' + hhmm(r.inicio) : '', local: r.local ? ', em ' + r.local : '', vereador: DEP() }; iniciarDisparo('Convite: ' + r.titulo, data.pessoas.filter(p => p.status !== 'Inativo' && p.telefone && (!r.municipio || !p.municipio || p.municipio === r.municipio)), preencher(msgTexto('convite'), v)); return; }
  const dp = e.target.closest('[data-disp-pular]'); if (dp) { avancarDisparo(false); return; }
  if (e.target.closest('[data-disp-enviar]')) { setTimeout(() => avancarDisparo(true), 300); return; }
  if (e.target.closest('[data-disp-reiniciar]')) { state.disp.i = 0; state.disp.feitos = []; render(); return; }
  if (e.target.closest('#msgs-padrao')) { if (!confirm('Voltar todas as mensagens ao texto original?')) return; store.setConfig('mensagens', {}).then(() => { msgs = {}; render(); toast('Mensagens originais de volta'); }).catch(err => toast(errMsg(err))); return; }
  if (e.target.closest('[data-recep-demanda]')) { const r = data.recepcao.find(x => x.id === drawer.id); const p = data.pessoas.find(x => normNome(x.nome) === normNome(r.nome)); closeDrawer(); if (r.status === 'Aguardando' || r.status === 'Em atendimento') store.saveRow('recepcao', r.id, { status: 'Atendido', historico: (r.historico || []).concat({ em: new Date().toISOString(), txt: 'Virou demanda', por: myName() }) }).then(row => upsertLocal('recepcao', row)).catch(() => {}); go('demandas'); openDrawer('demandas', null, { solicitante: r.nome, telefone: r.telefone || p?.telefone, bairro: r.bairro || p?.bairro, municipio: p?.municipio, assunto: r.motivo, origem: 'Presencial' }); return; }
  const cb = e.target.closest('[data-cid]'); if (cb) { closeDrawer(); abrirCidadao(cb.dataset.cid, cb.dataset.cidTel); return; }
  if (e.target.closest('[data-cid-nova]')) { const c = state.cid; const p = data.pessoas.find(x => normNome(x.nome) === normNome(c.nome)); go('demandas'); openDrawer('demandas', null, { solicitante: c.nome, telefone: c.tel || p?.telefone, municipio: p?.municipio, bairro: p?.bairro }); return; }
  if (e.target.closest('[data-cid-cadastrar]')) { const c = state.cid; const d = data.demandas.find(x => normNome(x.solicitante) === normNome(c.nome)); openDrawer('pessoas', null, { nome: c.nome, telefone: c.tel || d?.telefone, municipio: d?.municipio, bairro: d?.bairro }); return; }
  if (e.target.closest('#geo-buscar')) { geoBuscar(); return; }
  if (e.target.closest('#geo-gps')) { geoGps(); return; }
  if (e.target.closest('#geo-limpar')) { drawer.geo = null; geoMini?.marcar(null); geoInfo(); return; }
  if (e.target.closest('[data-tarefa-de]')) { const { mod, id } = drawer; const r = data[mod].find(x => x.id === id); closeDrawer(); go('tarefas'); openDrawer('tarefas', null, { relacionado: MODS[mod].sing + ': ' + (MODS[mod].title(r) || ''), prazo: addDays(todayStr(), 3) }); return; }
  const nv = e.target.closest('[data-novo]'); if (nv) { go(nv.dataset.novo); openDrawer(nv.dataset.novo, null); return; }
  if (e.target.closest('#btn-new')) { openDrawer(state.view === 'painel' ? 'demandas' : state.view, null); return; }
  if (e.target.closest('#btn-export, [data-exportar]')) { exportCsv(); return; }
  if (e.target.closest('[data-vcf]')) { exportVcf(); return; }
  if (e.target.closest('[data-trazer-pedidos]')) { const b = e.target.closest('[data-trazer-pedidos]'); b.disabled = true; b.textContent = 'Colocando…'; cadastrarQuemPediu().then(n => { toast(n + ' pessoa(s) colocada(s) na lista de contatos'); state.filter = 'pedidos'; render(); }).catch(err => { toast('Não foi possível: ' + errMsg(err)); render(); }); return; }
  if (e.target.closest('#btn-import, [data-importar]')) { state.imp = { mod: state.view }; go('importar'); return; }
  if (e.target.closest('#btn-avisos')) { abrirAvisos(); return; }
  if (e.target.closest('#av-notif')) { Notification.requestPermission().then(p => { toast(p === 'granted' ? 'Pronto: os avisos aparecem quando você abrir o sistema' : 'O navegador não liberou os avisos'); if (p === 'granted') { try { localStorage.removeItem('gabinete-aviso-dia'); } catch { /* ok */ } notificarNoComputador(); } abrirAvisos(); }); return; }
  const ab = e.target.closest('[data-anx-abrir]'); if (ab) { const r = data[drawer.mod].find(x => x.id === drawer.id); const x = r?.anexos?.[+ab.dataset.anxAbrir]; if (x) { const w = window.open('', '_blank'); store.linkAnexo(x.path).then(u => { if (w) w.location = u; else location.href = u; }).catch(err => { if (w) w.close(); toast(errMsg(err)); }); } return; }
  const av = e.target.closest('[data-anx-ver]'); if (av) { verMidia(+av.dataset.anxVer); return; }
  const ad = e.target.closest('[data-anx-del]'); if (ad) { if (ad.dataset.ok) removerAnexo(drawer.mod, drawer.id, +ad.dataset.anxDel).catch(err => toast(errMsg(err))); else { ad.dataset.ok = '1'; ad.textContent = 'Confirmar'; ad.classList.add('danger'); } return; }
  if (e.target.closest('#rel-print')) { window.print(); return; }
  const bk = e.target.closest('[data-backup]'); if (bk) { baixarBackup(bk); return; }
  if (e.target.closest('#btn-instalar')) { if (pedidoInstalar) { pedidoInstalar.prompt(); pedidoInstalar.userChoice.finally(() => { pedidoInstalar = null; render(); }); } return; }
  const rr = e.target.closest('[data-rel-rapido]'); if (rr) { const t = todayStr(), k = rr.dataset.relRapido; state.rel.de = k === 'mes' ? t.slice(0, 8) + '01' : k === 'ano' ? t.slice(0, 5) + '01-01' : ''; state.rel.ate = k === 'tudo' ? '' : t; render(); return; }
  if (e.target.closest('#imp-go')) { importarAgora(); return; }
  const mpd = e.target.closest('[data-mapa-de]'); if (mpd) { state.mapa.mod = mpd.dataset.mapaDe; state.mapa.org = ''; go('mapa'); return; }
  const mpm = e.target.closest('[data-mapa-mod]'); if (mpm) { state.mapa.mod = mpm.dataset.mapaMod; state.mapa.org = ''; render(); return; }
  const mps = e.target.closest('[data-mapa-so]'); if (mps) { state.mapa.so = mps.dataset.mapaSo; render(); return; }
  const mpf = e.target.closest('[data-mapa-foco]'); if (mpf) { if (!mapaLib.focar(mpf.dataset.mapaFoco, mpf.dataset.mapaFocoMun)) toast('Esse bairro ainda não foi achado no mapa.'); return; }
  if (e.target.closest('#imp-reset')) { state.imp = { mod: state.imp.mod }; render(); return; }
  if (e.target.closest('#pub-copiar')) { const i = $('#pub-link'); try { navigator.clipboard.writeText(i.value).then(() => toast('Link copiado')); } catch { i.select(); document.execCommand('copy'); toast('Link copiado'); } return; }
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
  const eqd = e.target.closest('[data-eq-del]'); if (eqd) { const em = eqd.dataset.eqDel; if (eqd.dataset.ok) { store.removeEquipe(em).then(() => { toast('Acesso removido'); render(); }).catch(err => toast(/row-level|policy|permission/i.test(errMsg(err)) ? 'Só o administrador pode remover e-mails' : errMsg(err))); } else { eqd.dataset.ok = '1'; eqd.textContent = 'Confirmar remoção'; eqd.classList.add('danger'); } return; }
  const mb = e.target.closest('[data-mod-baixar]'); if (mb) { docs.carregarModelo(mb.dataset.modBaixar).then(m => docs.baixar(new Blob([m.buf]), 'modelo-' + mb.dataset.modBaixar + '.docx')).catch(err => toast(errMsg(err))); return; }
  const mp = e.target.closest('[data-mod-padrao]'); if (mp) { store.setConfig('modelo:' + mp.dataset.modPadrao, null).then(() => { toast('Voltou ao modelo padrão'); render(); }).catch(err => toast(errMsg(err))); return; }
  if (e.target.closest('#g-cal-save')) { gcal.setCalendarId($('#g-cal').value.trim()); toast('Calendário salvo'); return; }
  if (e.target.closest('#et-print')) { window.print(); return; }
  if (e.target.closest('#pf-sair')) { store.signOut(); return; }
  if (e.target.closest('#pf-senha')) { renderSetPassword(); return; }
});
document.addEventListener('change', async e => {
  if (e.target.id === 'adm-quem') { carregarHistorico(); return; }
  if (e.target.id === 'mapa-per' || e.target.id === 'mapa-org') { state.mapa[e.target.id === 'mapa-per' ? 'per' : 'org'] = e.target.value; render(); return; }
  if (e.target.id === 'gf-de' || e.target.id === 'gf-ate') { state.graf[e.target.id === 'gf-de' ? 'de' : 'ate'] = e.target.value; render(); return; }
  const el = e.target;
  if (el.dataset && 'anxAdd' in el.dataset) { const files = [...el.files]; el.value = ''; if (files.length) anexarArquivos(drawer.mod, drawer.id, files).catch(err => toast('Não foi possível anexar: ' + errMsg(err))); return; }
  if (el.dataset && el.dataset.rel) { state.rel[el.dataset.rel] = el.value; if (el.dataset.rel === 'mod') Object.assign(state.rel, { municipio: '', bairro: '', status: '' }); render(); return; }
  if (el.dataset && el.dataset.rem) { state.rem[el.dataset.rem] = el.value; render(); return; }
  if (el.id === 'imp-mod') { const o = state.imp; state.imp = o.cabecalho ? { ...o, mod: el.value, mapa: imp.sugerirMapa(el.value, o.cabecalho) } : { mod: el.value }; render(); return; }
  if (el.dataset && el.dataset.impCol != null) { state.imp.mapa[+el.dataset.impCol] = el.value; render(); return; }
  if (el.id === 'imp-file') {
    const f = el.files[0]; if (!f) return;
    try { const { cabecalho, linhas } = await imp.lerArquivo(f); state.imp = { mod: state.imp.mod, arquivo: f.name, cabecalho, linhas, mapa: imp.sugerirMapa(state.imp.mod, cabecalho) }; render(); }
    catch (err) { toast(errMsg(err)); }
    return;
  }
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
  if (e.target.id === 'ag-form') { e.preventDefault(); ligarAgenda(); return; }
  if (e.target.id === 'eq-add') {
    e.preventDefault(); const em = $('#eq-email').value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { toast('Digite um e-mail válido'); return; }
    try { await store.addEquipe(em); toast('E-mail liberado'); render(); } catch (err) { toast(/duplicate/i.test(errMsg(err)) ? 'Esse e-mail já está liberado' : /row-level|policy|permission/i.test(errMsg(err)) ? 'Só o administrador pode liberar e-mails' : errMsg(err)); }
    return;
  }
  if (e.target.id === 'msgs') {
    e.preventDefault();
    const v = {}; Object.entries(MSG_PADRAO).forEach(([k, [, padrao]]) => { const t = $('#msg-' + k).value.trim(); if (t && t !== padrao) v[k] = t; });
    try { await store.setConfig('mensagens', v); msgs = v; toast('Mensagens salvas'); render(); } catch (err) { toast(errMsg(err)); }
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
  if (e.target.type === 'tel' && e.target.tagName === 'INPUT') { const m = mascaraTel(e.target.value); if (m !== e.target.value) e.target.value = m; }
  if (e.target.id === 'disp-texto' && state.disp) { state.disp.texto = e.target.value; const p = state.disp.lista[state.disp.i]; if (p) { const t = preencher(state.disp.texto, { nome: primeiroNome(p.nome), vereador: DEP() }); const pv = $('.disp-prev'); if (pv) pv.textContent = t; const b = $('[data-disp-enviar]'); if (b) b.href = waLink(p.telefone, t); } return; }
  if (e.target.id === 'q') { state.q = e.target.value; render(); }
  if (e.target.dataset && e.target.dataset.et) { state.et[e.target.dataset.et] = e.target.value; const pos = e.target.id; render(); const el = document.getElementById(pos); if (el) el.focus(); }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'geo-end') { e.preventDefault(); geoBuscar(); return; } if (e.key === 'Escape' && drawer.open) closeDrawer(); if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && drawer.open && drawer.mod) saveDrawer(); });

/* ---------- inicialização ---------- */
let unsub = null;
/* ---------- contador de visitas do site público (sem dados pessoais) ---------- */
let visitaContada = false;
function contarVisita(pagina) {
  if (visitaContada) return; visitaContada = true;
  let novo = true; const hoje = todayStr();
  try { const k = 'fc-visita-' + pagina; novo = localStorage.getItem(k) !== hoje; localStorage.setItem(k, hoje); } catch { /* sem armazenamento: conta como pessoa nova */ }
  store.registrarVisita(pagina, novo).catch(() => {});
}
const PAGINAS_VISITA = { inicio: 'Página inicial', solicitar: 'Fazer um pedido', consulta: 'Acompanhar pedido', prestacao: 'Prestação de contas', avaliar: 'Avaliar atendimento' };

async function startApp() {
  const qs = new URLSearchParams(location.search);
  const pub = ['solicitar', 'prestacao', 'consulta'].find(k => qs.has(k)) || (qs.get('avaliar') ? 'avaliar' : '');
  if (pub) contarVisita(pub);
  if (new URLSearchParams(location.search).has('solicitar')) return renderFormPublico();
  if (new URLSearchParams(location.search).has('prestacao')) return renderPrestacao();
  if (new URLSearchParams(location.search).has('consulta')) return renderConsulta(new URLSearchParams(location.search).get('consulta') || '');
  if (new URLSearchParams(location.search).get('avaliar')) return renderAvaliacao(new URLSearchParams(location.search).get('avaliar'));
  if (store.configured) {
    state.session = await store.getSession();
    if (!state.session) { if (!mustSetPassword) contarVisita('inicio'); return renderLogin(); }
    if (mustSetPassword) return renderSetPassword();
    if ((await store.isEquipe()) === false) return renderSemAcesso();
  } else state.session = await store.getSession();
  try { state.profiles = await store.loadProfiles(); } catch { state.profiles = []; }
  try { state.admin = await store.isAdmin(); } catch { state.admin = false; }
  store.registrarAcesso(aparelho()).catch(() => {});
  try { state.backup = await store.getConfig('backup'); } catch { /* ok */ }
  try { msgs = (await store.getConfig('mensagens')) || {}; } catch { msgs = {}; }
  try { const c = await store.getConfig('gabinete'); if (c) Object.entries(c).forEach(([k, v]) => { if (v) cfg[k] = v; }); } catch { /* usa os padrões */ }
  document.title = 'Fala Cascavel · ' + NOME_GAB();
  if (store.configured && !state.profiles.some(p => p.id === state.session.user.id)) return renderAskName();
  readHash();
  if (!location.hash) history.replaceState(null, '', location.pathname + '#painel');
  shell(); render();
  try {
    const faltam = [];
    const all = await Promise.all(ORDER.map(m => store.loadAll(m).catch(err => { if (/does not exist|schema cache|relation/i.test(errMsg(err))) { faltam.push(MODS[m].label); return []; } throw err; })));
    if (faltam.length) toast('Falta atualizar o banco para: ' + faltam.join(', '));
    ORDER.forEach((m, i) => { data[m] = all[i]; });
    state.loaded = true;
  } catch (e) { toast('Erro ao carregar dados: ' + errMsg(e)); }
  render();
  notificarNoComputador();
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
if ('serviceWorker' in navigator && location.protocol === 'https:') window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); pedidoInstalar = e; const b = $('#btn-instalar'); if (b) b.hidden = false; });
