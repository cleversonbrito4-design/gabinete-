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

export async function baixarArte(n, nomeArquivo) {
  const blob = await gerarArte(n);
  const file = new File([blob], nomeArquivo, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
    try { await navigator.share({ files: [file], title: 'Resultados do mês' }); return 'compartilhado'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelado'; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nomeArquivo; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return 'baixado';
}
