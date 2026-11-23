// Mapa dos pedidos por bairro. Usa OpenStreetMap (grátis) para o mapa e para achar
// o centro de cada bairro. As posições encontradas ficam guardadas (config "geo")
// para não precisar procurar de novo.
let L = null;
let mapa = null, camada = null;

export const chave = (bairro, mun) => (bairro + '|' + mun).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

async function carregarLeaflet() {
  if (L) return L;
  const [mod] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
  L = mod.default || mod;
  return L;
}

/* ================= busca de endereços e bairros =================
   1º OpenStreetMap (Nominatim), sempre preso à área do município, para não
   cair em outra cidade com o mesmo nome (ex.: Cascavel–CE).
   2º Photon (também OpenStreetMap, mas aceita erros de digitação).
   Um pedido por segundo no Nominatim, como ele exige. */
const UF_NOME = { AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins' };
const semAc = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const espera = ms => new Promise(r => setTimeout(r, ms));
let proximoNomi = 0;
async function nominatim(params) {
  const agora = Date.now(); const d = proximoNomi - agora; proximoNomi = Math.max(agora, proximoNomi) + 1100;
  if (d > 0) await espera(d);
  const q = new URLSearchParams({ format: 'jsonv2', countrycodes: 'br', 'accept-language': 'pt-BR', addressdetails: '1', limit: '8', ...params });
  const r = await fetch('https://nominatim.openstreetmap.org/search?' + q.toString(), { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('Serviço de mapas indisponível agora (' + r.status + '). Tente de novo em 1 minuto.');
  return (await r.json()).map(x => ({ lat: +x.lat, lon: +x.lon, tipo: x.addresstype || x.type, classe: x.category || x.class, nome: x.name || '', end: { ...(x.address || {}), housenumber: (x.address || {}).house_number }, bb: x.boundingbox ? x.boundingbox.map(Number) : null }));
}
async function photon(texto, area) {
  const q = new URLSearchParams({ q: texto, limit: '10' });
  if (area) { const [s, n, w, e] = area.bb; q.set('bbox', [w, s, e, n].join(',')); q.set('lat', area.centro[0]); q.set('lon', area.centro[1]); }
  const r = await fetch('https://photon.komoot.io/api/?' + q.toString(), { headers: { Accept: 'application/json' } });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.features || []).filter(f => !f.properties.countrycode || f.properties.countrycode === 'BR').map(f => ({ lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], tipo: f.properties.osm_value, classe: f.properties.osm_key, nome: f.properties.name || f.properties.street || '', end: { city: f.properties.city, suburb: f.properties.district || f.properties.locality, road: f.properties.street || (f.properties.osm_key === 'highway' ? f.properties.name : ''), housenumber: f.properties.housenumber } }));
}

/* área (retângulo) de cada município; guardada no aparelho */
const AREAS_CONHECIDAS = { 'cascavel|pr': { bb: [-25.30, -24.65, -53.82, -53.10], centro: [-24.9555, -53.4552] } };
const areas = {};
export async function areaMunicipio(mun, uf) {
  if (!mun) return null;
  const k = semAc(mun) + '|' + semAc(uf);
  if (areas[k]) return areas[k];
  try { const g = JSON.parse(localStorage.getItem('fc-area-' + k) || 'null'); if (g) return (areas[k] = g); } catch { /* ok */ }
  let a = null;
  try {
    const r = await nominatim({ q: [mun, UF_NOME[(uf || '').toUpperCase()] || uf, 'Brasil'].filter(Boolean).join(', '), limit: '5', addressdetails: '0' });
    const c = r.find(x => ['city', 'town', 'municipality', 'village', 'administrative'].includes(x.tipo) && semAc(x.nome) === semAc(mun)) || r.find(x => semAc(x.nome) === semAc(mun));
    if (c && c.bb) a = { bb: c.bb, centro: [c.lat, c.lon] };
  } catch { /* usa o conhecido */ }
  if (!a) a = AREAS_CONHECIDAS[k] || null;
  if (a) { areas[k] = a; try { localStorage.setItem('fc-area-' + k, JSON.stringify(a)); } catch { /* ok */ } }
  return a;
}
export const dentro = (p, a, folga = 0.02) => !a || (p[0] >= a.bb[0] - folga && p[0] <= a.bb[1] + folga && p[1] >= a.bb[2] - folga && p[1] <= a.bb[3] + folga);
const vbox = a => a ? { viewbox: [a.bb[2], a.bb[1], a.bb[3], a.bb[0]].join(','), bounded: '1' } : {};

const TIPOS_BAIRRO = ['suburb', 'neighbourhood', 'quarter', 'residential', 'city_district', 'borough', 'hamlet', 'village', 'locality', 'isolated_dwelling', 'allotments', 'farm', 'farmyard'];
const PREFIXOS = /^(jardim|jd\.?|parque|pq\.?|vila|vl\.?|conjunto|conj\.?|residencial|res\.?|loteamento|lot\.?|bairro|condominio|condomínio)\s+/i;
const parecido = (a, b) => { a = semAc(a); b = semAc(b); return !!a && !!b && (a === b || a.includes(b) || b.includes(a)); };
function melhorBairro(lista, nome, area) {
  const ok = lista.filter(x => dentro([x.lat, x.lon], area));
  const base = nome.replace(PREFIXOS, '');
  const nota = x => (TIPOS_BAIRRO.includes(x.tipo) ? 2 : 0) + (parecido(x.nome, nome) || parecido(x.nome, base) || parecido(x.end.suburb, nome) || parecido(x.end.suburb, base) ? 3 : 0);
  const b = ok.map(x => [nota(x), x]).filter(([n]) => n >= 3).sort((p, q) => q[0] - p[0])[0];
  return b ? [b[1].lat, b[1].lon] : null;
}
/** Acha o centro de um bairro dentro do município. Devolve [lat, lon] ou null. */
export async function localizarBairro(bairro, mun, uf) {
  const area = await areaMunicipio(mun, uf);
  const nome = String(bairro).replace(/\bjd\.?\s/i, 'Jardim ').replace(/\bpq\.?\s/i, 'Parque ').replace(/\bvl\.?\s/i, 'Vila ').trim();
  const sem = nome.replace(PREFIXOS, '');
  const variantes = [...new Set([nome, sem].filter(v => v.length > 2))];
  for (const v of variantes) {
    const r = await nominatim({ q: [v, area ? '' : mun].filter(Boolean).join(', '), ...vbox(area) });
    const p = melhorBairro(r, nome, area); if (p) return p;
  }
  try { const p = melhorBairro(await photon(nome + ' ' + mun, area), nome, area); if (p) return p; } catch { /* sem Photon */ }
  return null;
}
/**
 * Procura um endereço digitado (rua, nº, bairro). Tenta várias formas e devolve
 * [lat, lon] (com .aviso quando achou só a rua ou o bairro) ou null.
 */
export async function buscarEndereco(texto, { mun = '', uf = '' } = {}) {
  const area = await areaMunicipio(mun, uf);
  const partes = String(texto).split(/[,–-]/).map(x => x.trim()).filter(Boolean).filter(x => !mun || semAc(x) !== semAc(mun)).filter(x => !uf || semAc(x) !== semAc(uf));
  const numero = (partes.find((x, i) => i > 0 && /^(n[º°o.]?\s*)?\d+[a-z]?$/i.test(x)) || (/\b(\d{1,5})\s*$/.exec(partes[0] || '') || [])[1] || '').replace(/\D+/g, '');
  const rua = (partes[0] || '').replace(/\s*(n[º°o.]?\s*)?\d{1,5}\s*$/i, '').trim();
  const resto = partes.slice(1).filter(x => !/^(n[º°o.]?\s*)?\d+[a-z]?$/i.test(x) && !/^\d{5}-?\d{3}$/.test(x));
  const cidade = mun || '';
  const estado = UF_NOME[(uf || '').toUpperCase()] || uf || '';
  const pegar = (r, exigeRua) => { const x = r.find(y => dentro([y.lat, y.lon], area) && (!exigeRua || !rua || parecido(y.end.road || y.nome, rua.replace(/^(rua|r\.|avenida|av\.?|travessa|tv\.?|rodovia|estrada)\s+/i, '')))); return x ? [x.lat, x.lon] : null; };
  const tentativas = [];
  // 1. como foi digitado, preso ao município
  tentativas.push(() => nominatim({ q: [texto, area ? '' : cidade].filter(Boolean).join(', '), ...vbox(area) }).then(r => pegar(r, false)));
  if (rua) {
    // 2. busca por campos (rua + número + cidade)
    if (numero) tentativas.push(() => nominatim({ street: numero + ' ' + rua, city: cidade, state: estado, country: 'Brasil', ...vbox(area) }).then(r => pegar(r, true)));
    // 3. só a rua
    tentativas.push(() => nominatim({ street: rua, city: cidade, state: estado, country: 'Brasil', ...vbox(area) }).then(r => { const p = pegar(r, true); if (p && numero) p.aviso = 'Achei a rua, mas não o número. Arraste o alfinete até a casa.'; return p; }));
    // 4. Photon (aceita erro de digitação)
    tentativas.push(() => photon([rua, numero, cidade].filter(Boolean).join(' '), area).then(r => { const p = pegar(r, false); if (p && numero && !r.some(x => x.end.housenumber)) p.aviso = 'Posição aproximada. Confira e arraste o alfinete se precisar.'; return p; }).catch(() => null));
  }
  // 5. só o bairro
  for (const b of resto.slice(0, 1)) tentativas.push(() => localizarBairro(b, cidade, uf).then(p => { if (p) p.aviso = 'Achei só o bairro. Arraste o alfinete até o local exato.'; return p; }));
  for (const t of tentativas) { const p = await t(); if (p) return p; }
  return null;
}

/**
 * grupos: [{ bairro, municipio, total, abertos, atrasados, itens: [{titulo, status}] }]
 * cache: objeto { chave: [lat, lon] | { n: quando não achou } }
 * pinsBairro: { chave: [lat, lon] } média dos pontos exatos de cada bairro
 * salvarCache(cache) grava o cache no banco.
 * onClique(grupo) ao tocar num círculo.
 */
export async function desenhar(el, grupos, { cache, salvarCache, uf, cidadePadrao, onProgresso, onClique, esc, pontosExatos = [], pinsBairro = {}, onAbrir, onRota, onAviso }) {
  await carregarLeaflet();
  if (onAviso) avisar = onAviso;
  if (mapa && mapa.getContainer() !== el) { mapa.remove(); mapa = null; }
  if (!mapa) criarMapa(el);
  if (camada) camada.remove();
  camada = L.layerGroup().addTo(mapa);
  indice = {};

  // posição de cada bairro: 1º a média dos pedidos com ponto exato marcado nele;
  // 2º o que já foi achado antes (se estiver dentro do município); 3º procura agora.
  const posDe = {};
  const areaDe = {};
  for (const g of grupos) { const m = g.municipio || cidadePadrao; if (!(m in areaDe)) areaDe[m] = null; }
  for (const m in areaDe) { try { areaDe[m] = await areaMunicipio(m, uf); } catch { /* sem área */ } }
  const precisaProcurar = g => {
    const k = chave(g.bairro, g.municipio), c = cache[k];
    if (pinsBairro[k]) { posDe[k] = pinsBairro[k]; return false; }
    if (Array.isArray(c) && dentro(c, areaDe[g.municipio || cidadePadrao])) { posDe[k] = c; return false; }
    if (c && c.n && Date.now() - c.n < 3 * 864e5) return false; // não achou há menos de 3 dias
    return true;
  };
  const faltam = grupos.filter(precisaProcurar);
  let mudou = false;
  for (let i = 0; i < faltam.length; i++) {
    const g = faltam[i], k = chave(g.bairro, g.municipio);
    if (onProgresso) onProgresso(i + 1, faltam.length);
    try { const p = await localizarBairro(g.bairro, g.municipio || cidadePadrao, uf); cache[k] = p ? [p[0], p[1]] : { n: Date.now() }; if (p) posDe[k] = cache[k]; mudou = true; }
    catch { break; }
  }
  if (mudou && salvarCache) { try { await salvarCache(cache); } catch { /* segue sem guardar */ } }
  if (onProgresso) onProgresso(0, 0);
  if (!mapa) return []; // a tela mudou enquanto procurava

  const max = Math.max(1, ...grupos.map(g => g.total));
  const pontos = []; const semLocal = [];
  const idx = (bairro, mun) => { const k = chave(bairro || '', mun || ''); return indice[k] || (indice[k] = { pts: [], circulo: null }); };
  for (const g of grupos) {
    const pos = posDe[chave(g.bairro, g.municipio)];
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
