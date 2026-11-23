// Arte "Resultados do mês" (1080x1350) para o Instagram, no visual Fala Cascavel. Sem nomes de cidadãos.
const img = src => new Promise((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = erro; i.src = src; });

function caixa(x, X, Y, W, H, r) { x.beginPath(); if (x.roundRect) x.roundRect(X, Y, W, H, r); else x.rect(X, Y, W, H); }

/** n: { mes: 'NOVEMBRO 2026', recebidos, atendidos, oficios, bairros, top: [[bairro, n]...], vereador, cargo } */
export async function gerarArte(n) {
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  try { await document.fonts?.load('800 80px Archivo'); } catch { /* usa a padrão */ }
  const F = (peso, tam) => `${peso} ${tam}px Archivo, Arial, sans-serif`;
  const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#0d2236'); g.addColorStop(1, '#07111c');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.fillStyle = 'rgba(37,126,191,.20)'; x.beginPath(); x.arc(W - 40, 80, 300, 0, Math.PI * 2); x.fill();
  x.fillStyle = 'rgba(114,168,59,.16)'; x.beginPath(); x.arc(40, H - 40, 260, 0, Math.PI * 2); x.fill();
  try { const logo = await img(new URL('marca/fala-cascavel-branca.svg', document.baseURI).href); const lh = 100; x.drawImage(logo, 80, 70, logo.width / logo.height * lh || 280, lh); } catch { /* sem logo */ }
  x.fillStyle = '#8cc8f2'; x.font = F(700, 34); x.fillText('RESULTADOS DO MÊS', 80, 250);
  x.fillStyle = '#fff'; x.font = F(800, 84); x.fillText(n.mes, 76, 340);
  // 4 números
  const cards = [[n.recebidos, 'pedidos recebidos', '#257ebf'], [n.atendidos, 'pedidos atendidos', '#72a83b'], [n.oficios, 'ofícios enviados', '#257ebf'], [n.bairros, 'bairros atendidos', '#72a83b']];
  cards.forEach(([v, rot, cor], i) => {
    const X = 80 + (i % 2) * 470, Y = 400 + Math.floor(i / 2) * 250;
    x.fillStyle = 'rgba(255,255,255,.07)'; caixa(x, X, Y, 450, 220, 32); x.fill();
    x.strokeStyle = 'rgba(255,255,255,.14)'; x.lineWidth = 2; caixa(x, X, Y, 450, 220, 32); x.stroke();
    x.fillStyle = cor; caixa(x, X + 36, Y + 36, 60, 8, 4); x.fill();
    x.fillStyle = '#fff'; x.font = F(800, 96); x.fillText(String(v), X + 34, Y + 145);
    x.fillStyle = 'rgba(255,255,255,.75)'; x.font = F(600, 32); x.fillText(rot, X + 36, Y + 192);
  });
  // bairros com mais pedidos atendidos
  let y = 940;
  if (n.top.length) {
    x.fillStyle = '#8cc8f2'; x.font = F(700, 30); x.fillText('ONDE O GABINETE ATENDEU', 80, y); y += 20;
    n.top.slice(0, 3).forEach(([b, q]) => {
      y += 62; x.fillStyle = '#fff'; x.font = F(700, 40);
      let nome = b; while (x.measureText(nome).width > 760 && nome.length > 4) nome = nome.slice(0, -2);
      x.fillText(nome === b ? b : nome + '…', 80, y);
      x.textAlign = 'right'; x.fillStyle = '#72a83b'; x.fillText(String(q), W - 80, y); x.textAlign = 'left';
    });
  }
  x.fillStyle = 'rgba(255,255,255,.85)'; x.font = F(700, 34); x.textAlign = 'center';
  x.fillText('Faça seu pedido: falacascavel.com.br', W / 2, H - 120);
  x.fillStyle = 'rgba(255,255,255,.55)'; x.font = F(500, 28);
  x.fillText([n.vereador, n.cargo].filter(Boolean).join(' · '), W / 2, H - 72);
  return new Promise(ok => c.toBlob(ok, 'image/png'));
}

function quebrar(x, texto, larg, max) {
  const pal = String(texto || '').split(/\s+/).filter(Boolean); const out = []; let l = '';
  for (const p of pal) { const t = l ? l + ' ' + p : p; if (x.measureText(t).width > larg && l) { out.push(l); l = p; } else l = t; }
  if (l) out.push(l);
  if (out.length > max) { out.length = max; let u = out[max - 1]; while (x.measureText(u + '…').width > larg && u.length > 3) u = u.slice(0, -1); out[max - 1] = u + '…'; }
  return out;
}
/** Arte "Pedido atendido" (1080x1350). p: { assunto, bairro, cidade, foto (url ou null), vereador, cargo } */
export async function gerarArteAtendido(p) {
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  try { await document.fonts?.load('800 80px Archivo'); } catch { /* usa a padrão */ }
  const F = (peso, tam) => `${peso} ${tam}px Archivo, Arial, sans-serif`;
  const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#0d2236'); g.addColorStop(1, '#07111c');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.fillStyle = 'rgba(114,168,59,.18)'; x.beginPath(); x.arc(W - 40, 60, 300, 0, Math.PI * 2); x.fill();
  try { const logo = await img(new URL('marca/fala-cascavel-branca.svg', document.baseURI).href); const lh = 84; x.drawImage(logo, 70, 56, logo.width / logo.height * lh || 240, lh); } catch { /* sem logo */ }
  // foto (ou um grande ✓)
  const FX = 70, FY = 180, FW = W - 140, FH = 640;
  let foto = null;
  if (p.foto) { try { const r = await fetch(p.foto); const b = await r.blob(); foto = await img(URL.createObjectURL(b)); } catch { foto = null; } }
  x.save(); caixa(x, FX, FY, FW, FH, 40); x.clip();
  if (foto) { const esc = Math.max(FW / foto.width, FH / foto.height); const w = foto.width * esc, h = foto.height * esc; x.drawImage(foto, FX + (FW - w) / 2, FY + (FH - h) / 2, w, h); }
  else { const gg = x.createLinearGradient(FX, FY, FX + FW, FY + FH); gg.addColorStop(0, '#1d4f78'); gg.addColorStop(1, '#2f6b2a'); x.fillStyle = gg; x.fillRect(FX, FY, FW, FH);
    x.strokeStyle = '#fff'; x.lineWidth = 46; x.lineCap = 'round'; x.lineJoin = 'round'; x.beginPath(); x.moveTo(W / 2 - 150, FY + FH / 2 + 10); x.lineTo(W / 2 - 40, FY + FH / 2 + 120); x.lineTo(W / 2 + 170, FY + FH / 2 - 110); x.stroke(); }
  x.restore();
  // selo
  x.font = F(800, 40); const selo = '✓ PEDIDO ATENDIDO'; const sw = x.measureText(selo).width + 64;
  x.fillStyle = '#72a83b'; caixa(x, FX + 30, FY + FH - 96, sw, 72, 36); x.fill();
  x.fillStyle = '#fff'; x.fillText(selo, FX + 62, FY + FH - 46);
  // assunto e bairro
  let y = FY + FH + 96;
  x.fillStyle = '#fff'; x.font = F(800, 58);
  quebrar(x, p.assunto, W - 140, 3).forEach(l => { x.fillText(l, 70, y); y += 68; });
  const lugar = [p.bairro, p.cidade].filter(Boolean).join(' · ');
  if (lugar) { x.fillStyle = '#8cc8f2'; x.font = F(700, 36); x.fillText(lugar.toLocaleUpperCase('pt-BR'), 70, y + 6); }
  x.textAlign = 'center';
  x.fillStyle = 'rgba(255,255,255,.88)'; x.font = F(700, 32); x.fillText('Pedido levado pelo ' + [p.cargo ? p.cargo.split('/')[0].trim().toLowerCase() : 'vereador', p.vereador].filter(Boolean).join(' '), W / 2, H - 112);
  x.fillStyle = 'rgba(255,255,255,.6)'; x.font = F(600, 28); x.fillText('Faça seu pedido: falacascavel.com.br', W / 2, H - 66);
  return new Promise(ok => c.toBlob(ok, 'image/png'));
}

export async function baixarArte(n, nomeArquivo, gerar = gerarArte) {
  const blob = await gerar(n);
  const file = new File([blob], nomeArquivo, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
    try { await navigator.share({ files: [file], title: 'Resultados do mês' }); return 'compartilhado'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelado'; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nomeArquivo; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return 'baixado';
}
