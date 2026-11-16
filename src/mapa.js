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
export async function desenhar(el, grupos, { cache, salvarCache, uf, cidadePadrao, onProgresso, onClique, esc, pontosExatos = [], onAbrir, onRota }) {
  await carregarLeaflet();
  if (mapa && mapa.getContainer() !== el) { mapa.remove(); mapa = null; }
  if (!mapa) {
    mapa = L.map(el, { scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; colaboradores do <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(mapa);
  }
  if (camada) camada.remove();
  camada = L.layerGroup().addTo(mapa);

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

  const max = Math.max(1, ...grupos.map(g => g.total));
  const pontos = []; const semLocal = [];
  for (const g of grupos) {
    const pos = cache[chave(g.bairro, g.municipio)];
    if (!pos) { semLocal.push(g); continue; }
    pontos.push(pos);
    const cor = g.atrasados ? '#b3261e' : g.abertos ? '#c77700' : '#1c7a3d';
    const c = L.circleMarker(pos, { radius: 8 + 22 * Math.sqrt(g.total / max), color: cor, weight: 2, fillColor: cor, fillOpacity: 0.35 }).addTo(camada);
    c.bindTooltip(`<b>${esc(g.bairro)}</b> · ${g.total}`, { direction: 'top' });
    c.bindPopup(`<b>${esc(g.bairro)}</b>${g.municipio ? ' · ' + esc(g.municipio) : ''}<br>${g.total} pedido(s), ${g.abertos} em aberto${g.atrasados ? ', <b style="color:#b3261e">' + g.atrasados + ' atrasado(s)</b>' : ''}<ul style="margin:6px 0 4px;padding-left:16px">${g.itens.slice(0, 6).map(x => `<li>${esc(x.titulo)} <i>(${esc(x.status)})</i></li>`).join('')}</ul><a href="#" data-mapa-ver="${esc(g.bairro)}">Ver todos deste bairro</a>${onRota ? ' · <a href="#" data-mapa-rota>+ Roteiro</a>' : ''}`);
    c.on('popupopen', ev => { const el = ev.popup.getElement(); const a = el.querySelector('[data-mapa-ver]'); if (a) a.addEventListener('click', e => { e.preventDefault(); onClique(g); }); const r = el.querySelector('[data-mapa-rota]'); if (r) r.addEventListener('click', e => { e.preventDefault(); onRota({ titulo: g.bairro + (g.municipio ? ' · ' + g.municipio : ''), lat: pos[0], lng: pos[1] }); mapa.closePopup(); }); });
  }
  // pedidos com o ponto exato marcado
  for (const p of pontosExatos) {
    pontos.push([p.lat, p.lng]);
    const cor = p.atrasado ? '#b3261e' : p.aberto ? '#c77700' : '#1c7a3d';
    const c = L.circleMarker([p.lat, p.lng], { radius: 7, color: '#fff', weight: 2, fillColor: cor, fillOpacity: 1 }).addTo(camada);
    c.bindTooltip(esc(p.titulo), { direction: 'top' });
    c.bindPopup(`<b>${esc(p.titulo)}</b><br><i>${esc(p.status)}</i>${p.sub ? '<br>' + esc(p.sub) : ''}<br><a href="#" data-mapa-abrir>Abrir registro</a> · <a href="https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}" target="_blank" rel="noopener">Google Maps</a>${onRota ? ' · <a href="#" data-mapa-rota>+ Roteiro</a>' : ''}`);
    c.on('popupopen', ev => { const el = ev.popup.getElement(); const a = el.querySelector('[data-mapa-abrir]'); if (a) a.addEventListener('click', e => { e.preventDefault(); onAbrir(p); }); const r = el.querySelector('[data-mapa-rota]'); if (r) r.addEventListener('click', e => { e.preventDefault(); onRota({ titulo: p.titulo + (p.sub ? ' · ' + p.sub : ''), lat: p.lat, lng: p.lng }); mapa.closePopup(); }); });
  }
  if (pontos.length) mapa.fitBounds(L.latLngBounds(pontos).pad(0.15), { maxZoom: 14 });
  else mapa.setView([-24.9555, -53.4552], 12); // Cascavel–PR
  setTimeout(() => mapa.invalidateSize(), 50);
  return semLocal;
}

export function destruir() { if (mapa) { mapa.remove(); mapa = null; camada = null; } }

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
  m.setView(pos || centro || [-24.9555, -53.4552], pos ? 17 : 13);
  marcar(pos);
  setTimeout(() => m.invalidateSize(), 60);
  return { marcar, remover: () => m.remove() };
}
