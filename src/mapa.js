// Mapa dos pedidos por bairro. Usa OpenStreetMap (grátis) para o mapa e para achar
// o centro de cada bairro. As posições encontradas ficam guardadas (config "geo")
// para não precisar procurar de novo.
let L = null;
let mapa = null, camada = null;

const chave = (bairro, mun) => (bairro + '|' + mun).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

async function carregarLeaflet() {
  if (L) return L;
  const [mod] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
  L = mod.default || mod;
  return L;
}

/** Procura o centro do bairro no OpenStreetMap (no máximo 1 pedido por segundo). */
async function geocodificar(bairro, mun, uf) { return buscarEndereco([bairro, mun, uf].filter(Boolean).join(', ')); }
/** Procura um endereço livre (rua, nº, bairro, cidade). Devolve [lat, lon] ou null. */
export async function buscarEndereco(texto) {
  const q = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'br', 'accept-language': 'pt-BR', q: texto + ', Brasil' });
  const r = await fetch('https://nominatim.openstreetmap.org/search?' + q.toString(), { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('Serviço de mapas indisponível agora (' + r.status + ').');
  const j = await r.json();
  return j[0] ? [+j[0].lat, +j[0].lon] : null;
}

/**
 * grupos: [{ bairro, municipio, total, abertos, atrasados, itens: [{titulo, status}] }]
 * cache: objeto { chave: [lat, lon] | 0 } (0 = não encontrado)
 * salvarCache(cache) grava o cache no banco.
 * onClique(grupo) ao tocar num círculo.
 */
export async function desenhar(el, grupos, { cache, salvarCache, uf, cidadePadrao, onProgresso, onClique, esc, pontosExatos = [], onAbrir, onRota, onAviso }) {
  await carregarLeaflet();
  if (onAviso) avisar = onAviso;
  if (mapa && mapa.getContainer() !== el) { mapa.remove(); mapa = null; }
  if (!mapa) criarMapa(el);
  if (camada) camada.remove();
  camada = L.layerGroup().addTo(mapa);
  indice = {};

  // posições que ainda não conhecemos
  const faltam = grupos.filter(g => !(chave(g.bairro, g.municipio) in cache));
  let mudou = false;
  for (let i = 0; i < faltam.length; i++) {
    const g = faltam[i];
    if (onProgresso) onProgresso(i + 1, faltam.length);
    try { cache[chave(g.bairro, g.municipio)] = (await geocodificar(g.bairro, g.municipio || cidadePadrao, uf)) || 0; mudou = true; }
    catch { break; }
    if (i < faltam.length - 1) await new Promise(r => setTimeout(r, 1100));
  }
  if (mudou && salvarCache) { try { await salvarCache(cache); } catch { /* segue sem guardar */ } }
  if (onProgresso) onProgresso(0, 0);
  if (!mapa) return []; // a tela mudou enquanto procurava

  const max = Math.max(1, ...grupos.map(g => g.total));
  const pontos = []; const semLocal = [];
  const idx = (bairro, mun) => { const k = chave(bairro || '', mun || ''); return indice[k] || (indice[k] = { pts: [], circulo: null }); };
  for (const g of grupos) {
    const pos = cache[chave(g.bairro, g.municipio)];
    if (!pos) { semLocal.push(g); continue; }
    pontos.push(pos);
    const cor = corDe(g.atrasados, g.abertos);
    const raio = 10 + 22 * Math.sqrt(g.total / max);
    const c = L.circleMarker(pos, { radius: raio, color: cor, weight: 2, fillColor: cor, fillOpacity: 0.38 }).addTo(camada);
    // número de pedidos escrito no meio do círculo
    L.marker(pos, { interactive: false, keyboard: false, icon: L.divIcon({ className: 'mapa-num', html: `<span style="font-size:${raio > 20 ? 13 : 11}px">${g.total}</span>`, iconSize: [40, 20], iconAnchor: [20, 10] }) }).addTo(camada);
    const ix = idx(g.bairro, g.municipio); ix.circulo = c; ix.pts.push(pos);
    c.bindTooltip(`<b>${esc(g.bairro)}</b> · ${g.total} pedido(s)`, { direction: 'top', offset: [0, -raio + 4] });
    c.bindPopup(`<b>${esc(g.bairro)}</b>${g.municipio ? ' · ' + esc(g.municipio) : ''}<br>${g.total} pedido(s), ${g.abertos} em aberto${g.atrasados ? ', <b style="color:#e5484d">' + g.atrasados + ' atrasado(s)</b>' : ''}<ul style="margin:6px 0 4px;padding-left:16px">${g.itens.slice(0, 6).map(x => `<li>${esc(x.titulo)} <i>(${esc(x.status)})</i></li>`).join('')}</ul><a href="#" data-mapa-ver="${esc(g.bairro)}">Ver todos deste bairro</a>${onRota ? ' · <a href="#" data-mapa-rota>+ Roteiro</a>' : ''}`);
    c.on('popupopen', ev => { const el = ev.popup.getElement(); const a = el.querySelector('[data-mapa-ver]'); if (a) a.addEventListener('click', e => { e.preventDefault(); onClique(g); }); const r = el.querySelector('[data-mapa-rota]'); if (r) r.addEventListener('click', e => { e.preventDefault(); onRota({ titulo: g.bairro + (g.municipio ? ' · ' + g.municipio : ''), lat: pos[0], lng: pos[1] }); mapa.closePopup(); }); });
  }
  // pedidos com o ponto exato marcado
  for (const p of pontosExatos) {
    pontos.push([p.lat, p.lng]);
    const cor = corDe(p.atrasado, p.aberto);
    const c = L.circleMarker([p.lat, p.lng], { radius: 7, color: '#fff', weight: 2, fillColor: cor, fillOpacity: 1 }).addTo(camada);
    if (p.bairro) idx(p.bairro, p.municipio).pts.push([p.lat, p.lng]);
    c.bindTooltip(esc(p.titulo), { direction: 'top' });
    c.bindPopup(`<b>${esc(p.titulo)}</b><br><i>${esc(p.status)}</i>${p.sub ? '<br>' + esc(p.sub) : ''}<br><a href="#" data-mapa-abrir>Abrir registro</a> · <a href="https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}" target="_blank" rel="noopener">Google Maps</a>${onRota ? ' · <a href="#" data-mapa-rota>+ Roteiro</a>' : ''}`);
    c.on('popupopen', ev => { const el = ev.popup.getElement(); const a = el.querySelector('[data-mapa-abrir]'); if (a) a.addEventListener('click', e => { e.preventDefault(); onAbrir(p); }); const r = el.querySelector('[data-mapa-rota]'); if (r) r.addEventListener('click', e => { e.preventDefault(); onRota({ titulo: p.titulo + (p.sub ? ' · ' + p.sub : ''), lat: p.lat, lng: p.lng }); mapa.closePopup(); }); });
  }
  if (pontos.length) mapa.fitBounds(L.latLngBounds(pontos).pad(0.15), { maxZoom: 14 });
  else mapa.setView(CASCAVEL, 12);
  setTimeout(() => mapa && mapa.invalidateSize(), 50);
  return semLocal;
}

const CASCAVEL = [-24.9555, -53.4552];
let indice = {};
const corDe = (atrasado, aberto) => atrasado ? '#e5484d' : aberto ? '#f0a020' : '#3fb06a';

/* fundos do mapa: ruas (claro), escuro e satélite */
const FUNDOS = {
  'Ruas': () => L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }),
  'Escuro': () => L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, subdomains: 'abcd', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>' }),
  'Satélite': () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 18, attribution: 'Imagens &copy; Esri' }),
};
const temaEscuro = () => { const t = document.documentElement.dataset.theme; return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };
function fundoInicial() { let f = ''; try { f = localStorage.getItem('fc-mapa-fundo') || ''; } catch { /* ok */ } return FUNDOS[f] ? f : temaEscuro() ? 'Escuro' : 'Ruas'; }

function botao(titulo, html, acao) {
  const C = L.Control.extend({ onAdd() { const b = L.DomUtil.create('a', 'mapa-bt'); b.href = '#'; b.title = titulo; b.setAttribute('role', 'button'); b.setAttribute('aria-label', titulo); b.innerHTML = html; L.DomEvent.disableClickPropagation(b); L.DomEvent.on(b, 'click', e => { L.DomEvent.preventDefault(e); acao(b); }); const w = L.DomUtil.create('div', 'leaflet-bar'); w.appendChild(b); return w; } });
  return new C({ position: 'topleft' });
}

let euMarcador = null, avisar = m => alert(m);
function criarMapa(el) {
  mapa = L.map(el, { scrollWheelZoom: false });
  mapa.attributionControl.setPrefix(false);
  const camadas = {}; for (const k in FUNDOS) camadas[k] = FUNDOS[k]();
  camadas[fundoInicial()].addTo(mapa);
  L.control.layers(camadas, null, { position: 'topright', collapsed: false }).addTo(mapa);
  mapa.on('baselayerchange', e => { try { localStorage.setItem('fc-mapa-fundo', e.name); } catch { /* ok */ } });
  // tela cheia (funciona também no iPhone, ocupando a tela toda)
  const wrap = el.closest('.mapa-wrap') || el;
  const tela = b => { const on = !wrap.classList.contains('cheio'); wrap.classList.toggle('cheio', on); document.body.classList.toggle('mapa-cheio', on); b.innerHTML = on ? '✕' : '⛶'; b.title = on ? 'Sair da tela cheia' : 'Tela cheia'; mapa.scrollWheelZoom[on ? 'enable' : 'disable'](); setTimeout(() => mapa && mapa.invalidateSize(), 60); };
  const btTela = botao('Tela cheia', '⛶', b => { tela(b); document[wrap.classList.contains('cheio') ? 'addEventListener' : 'removeEventListener']('keydown', esc); });
  const esc = e => { if (e.key === 'Escape' && mapa && mapa._sairTela) mapa._sairTela(); };
  btTela.addTo(mapa);
  mapa._sairTela = () => { document.removeEventListener('keydown', esc); if (wrap.classList.contains('cheio')) { const b = btTela.getContainer().firstChild; tela(b); } };
  // onde estou
  botao('Onde estou', '◎', b => {
    if (!navigator.geolocation) { avisar('Este aparelho não informa a localização.'); return; }
    b.classList.add('busca');
    navigator.geolocation.getCurrentPosition(p => {
      b.classList.remove('busca'); if (!mapa) return;
      const ll = [p.coords.latitude, p.coords.longitude];
      if (euMarcador) euMarcador.remove();
      euMarcador = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#2f8cff', fillOpacity: 1 }).addTo(mapa).bindTooltip('Você está aqui');
      mapa.setView(ll, 16);
    }, () => { b.classList.remove('busca'); avisar('Não consegui pegar sua localização. Verifique se o GPS está ligado e se o navegador tem permissão.'); }, { enableHighAccuracy: true, timeout: 12000 });
  }).addTo(mapa);
  // legenda
  const Leg = L.Control.extend({ onAdd() { const d = L.DomUtil.create('div', 'mapa-leg'); d.innerHTML = '<span><i style="background:#e5484d"></i>Atrasado</span><span><i style="background:#f0a020"></i>Em aberto</span><span><i style="background:#3fb06a"></i>Resolvido</span>'; return d; } });
  new Leg({ position: 'bottomleft' }).addTo(mapa);
}

/** Leva o mapa até um bairro (lista "Bairros com mais pedidos"). */
export function focar(bairro, municipio) {
  if (!mapa) return false;
  const ix = indice[chave(bairro || '', municipio || '')];
  if (!ix || !ix.pts.length) return false;
  mapa.getContainer().scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (ix.circulo) { mapa.flyTo(ix.circulo.getLatLng(), Math.max(mapa.getZoom(), 15), { duration: 0.8 }); mapa.once('moveend', () => ix.circulo.openPopup()); }
  else if (ix.pts.length === 1) mapa.flyTo(ix.pts[0], 17, { duration: 0.8 });
  else mapa.flyToBounds(L.latLngBounds(ix.pts).pad(0.3), { maxZoom: 17, duration: 0.8 });
  return true;
}

export function sairTelaCheia() { if (mapa && mapa._sairTela) mapa._sairTela(); }

export function destruir() { if (mapa) { if (mapa._sairTela) mapa._sairTela(); mapa.remove(); mapa = null; camada = null; euMarcador = null; indice = {}; } }

/* ---------- mapinha dentro do registro, para marcar o ponto exato ---------- */
export async function miniMapa(el, pos, onPick, centro) {
  await carregarLeaflet();
  const m = L.map(el, { scrollWheelZoom: false, tap: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(m);
  const icone = L.divIcon({ className: 'pin', html: '<span></span>', iconSize: [26, 34], iconAnchor: [13, 32] });
  let mk = null;
  const marcar = (p, centralizar) => {
    if (!p) { if (mk) { mk.remove(); mk = null; } return; }
    if (!mk) { mk = L.marker(p, { draggable: true, icon: icone }).addTo(m); mk.on('dragend', () => { const ll = mk.getLatLng(); onPick([ll.lat, ll.lng]); }); }
    else mk.setLatLng(p);
    if (centralizar) m.setView(p, Math.max(m.getZoom() || 0, 17));
  };
  m.on('click', e => { const p = [e.latlng.lat, e.latlng.lng]; marcar(p); onPick(p); });
  m.setView(pos || centro || CASCAVEL, pos ? 17 : 13);
  marcar(pos);
  setTimeout(() => m.invalidateSize(), 60);
  return { marcar, remover: () => m.remove() };
}
