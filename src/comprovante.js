// Comprovante do pedido em imagem (PNG) com QR code que abre a consulta do protocolo.
import QRCode from 'qrcode';

const carregarImg = src => new Promise((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = erro; i.src = src; });

function quebrar(ctx, txt, larg) {
  const out = []; let l = '';
  String(txt || '').split(/\s+/).forEach(p => { const t = l ? l + ' ' + p : p; if (ctx.measureText(t).width > larg && l) { out.push(l); l = p; } else l = t; });
  if (l) out.push(l); return out;
}

/** Desenha o comprovante e devolve um Blob PNG. */
export async function gerarComprovante({ protocolo, assunto, nome, data, link, gabinete }) {
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#0b1d2e'); g.addColorStop(1, '#07111c');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.fillStyle = 'rgba(37,126,191,.18)'; x.beginPath(); x.arc(W - 80, 120, 260, 0, Math.PI * 2); x.fill();
  x.fillStyle = 'rgba(114,168,59,.14)'; x.beginPath(); x.arc(60, H - 60, 220, 0, Math.PI * 2); x.fill();
  try { const logo = await carregarImg(new URL('marca/fala-cascavel-branca.svg', document.baseURI).href); const lh = 110, lw = logo.width / logo.height * lh || 300; x.drawImage(logo, 80, 70, lw, lh); } catch { /* sem logo */ }
  x.textAlign = 'left'; x.fillStyle = '#8cc8f2'; x.font = '700 34px Archivo, Arial, sans-serif';
  x.fillText('COMPROVANTE DE PEDIDO', 80, 250);
  x.fillStyle = '#fff'; x.font = '800 104px Archivo, Arial, sans-serif'; x.fillText(protocolo, 76, 360);
  x.font = '500 36px Arial, sans-serif'; x.fillStyle = 'rgba(255,255,255,.85)';
  let y = 430;
  quebrar(x, assunto, W - 160).slice(0, 2).forEach(l => { x.fillText(l, 80, y); y += 46; });
  x.font = '400 30px Arial, sans-serif'; x.fillStyle = 'rgba(255,255,255,.6)';
  x.fillText([nome, data].filter(Boolean).join(' · '), 80, y + 6);
  // QR
  const qr = document.createElement('canvas');
  await QRCode.toCanvas(qr, link, { width: 440, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#07111c', light: '#ffffff' } });
  const qx = (W - 480) / 2, qy = 590;
  x.fillStyle = '#fff'; x.beginPath(); x.roundRect ? x.roundRect(qx, qy, 480, 480, 36) : x.rect(qx, qy, 480, 480); x.fill();
  x.drawImage(qr, qx + 20, qy + 20, 440, 440);
  x.textAlign = 'center'; x.fillStyle = '#fff'; x.font = '700 38px Arial, sans-serif';
  x.fillText('Aponte a câmera para acompanhar', W / 2, qy + 545);
  x.font = '400 28px Arial, sans-serif'; x.fillStyle = 'rgba(255,255,255,.65)';
  x.fillText('Digite o celular informado no pedido para ver a situação.', W / 2, qy + 590);
  x.fillStyle = 'rgba(255,255,255,.45)'; x.font = '400 24px Arial, sans-serif';
  x.fillText(link.replace(/^https?:\/\//, ''), W / 2, H - 70);
  if (gabinete) x.fillText(gabinete, W / 2, H - 34);
  return new Promise(ok => c.toBlob(ok, 'image/png'));
}

/** Compartilha (celular) ou baixa (computador) o comprovante. */
export async function enviarComprovante(dados) {
  const blob = await gerarComprovante(dados);
  const nome = 'protocolo-' + dados.protocolo + '.png';
  const file = new File([blob], nome, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
    try { await navigator.share({ files: [file], title: 'Protocolo ' + dados.protocolo }); return 'compartilhado'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelado'; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return 'baixado';
}
