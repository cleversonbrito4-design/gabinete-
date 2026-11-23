// Gera ofícios e indicações em Word (.docx) a partir de modelos.
// O modelo padrão fica em public/modelos/; o gabinete pode enviar o próprio
// modelo (feito no Word, com os campos entre chaves) pela tela "Minha conta".
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import * as store from './store.js';

export const TIPOS = { oficio: 'Ofício', requerimento: 'Requerimento', indicacao: 'Indicação', mocao: 'Moção', projeto_lei: 'Projeto de Lei' };

export const CAMPOS = [
  ['numero', 'Número do ofício (ex.: 164)'], ['numero_doc', 'Número de indicação/requerimento (em branco até a Câmara numerar)'], ['ano', 'Ano'], ['data_extenso', 'Data por extenso (16 de novembro de 2026)'],
  ['cidade_gabinete', 'Cidade do gabinete'], ['destinatario', 'Destinatário'], ['orgao', 'Órgão'], ['destinatario_orgao', 'Destinatário e órgão juntos'],
  ['municipio_uf', 'Município do pedido'], ['assunto', 'Assunto / serviço'], ['local_texto', '", na Rua X, em Município" (indicação)'],
  ['titulo_doc', 'Título (MOÇÃO DE APLAUSO / PROJETO DE LEI)'], ['ementa_doc', 'Ementa do projeto de lei'], ['texto', 'Texto do requerimento/indicação/moção (REQUEIRO… / INDICO…)'], ['#paragrafos', 'Parágrafos do ofício (use {#paragrafos}{.}{/paragrafos}, cada um em uma linha)'],
  ['#justificativa', 'Parágrafos da justificativa (use {#justificativa}{.}{/justificativa})'], ['vocativo', 'Vocativo (Senhor Prefeito)'], ['solicitante', 'Quem pediu'], ['proponente', 'Vereador Fulano/PARTIDO'], ['gabinete_maiusculo', 'Nome do gabinete em maiúsculas'],
  ['deputado_nome', 'Nome do deputado'], ['deputado_cargo', 'Cargo (Deputado Estadual)'], ['gabinete', 'Nome do gabinete'],
  ['casa_legislativa', 'Casa legislativa'], ['endereco_gabinete', 'Endereço e contato do gabinete'],
];

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export function dataExtenso(d = new Date()) { return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`; }

function b64ToBuf(b64) { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
export function bufToB64(buf) { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }

/** Devolve o modelo (ArrayBuffer) e se é personalizado. */
export async function carregarModelo(tipo) {
  const c = await store.getConfig('modelo:' + tipo).catch(() => null);
  if (c && c.arquivo) return { buf: b64ToBuf(c.arquivo), nome: c.nome, proprio: true };
  const r = await fetch(import.meta.env.BASE_URL + 'modelos/' + tipo + '.docx');
  if (!r.ok) throw new Error('Modelo padrão não encontrado.');
  return { buf: await r.arrayBuffer(), nome: 'Modelo padrão', proprio: false };
}

/** Confere se um arquivo enviado é um .docx que o sistema consegue preencher. */
export function validarModelo(buf) {
  const doc = new Docxtemplater(new PizZip(buf), { paragraphLoop: true, linebreaks: true, nullGetter: () => '' });
  doc.render({});
}

export async function gerarDocx(tipo, valores) {
  const { buf } = await carregarModelo(tipo);
  let doc;
  try {
    doc = new Docxtemplater(new PizZip(buf), { paragraphLoop: true, linebreaks: true, nullGetter: () => '' });
    doc.render(valores);
  } catch (e) {
    const det = e.properties && e.properties.errors ? e.properties.errors.map(x => x.properties && x.properties.explanation).filter(Boolean).join('; ') : e.message;
    throw new Error('O modelo de Word tem um campo mal escrito: ' + det);
  }
  return doc.getZip().generate({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

export function baixar(blob, nome) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ---------- fotos e mapa no final do documento ---------- */
const EMU_CM = 360000;
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const par = (txt, { negrito, centro, tam = 22, quebra } = {}) => `<w:p><w:pPr>${centro ? '<w:jc w:val="center"/>' : ''}<w:spacing w:before="60" w:after="60"/></w:pPr>${quebra ? '<w:r><w:br w:type="page"/></w:r>' : ''}${txt ? `<w:r><w:rPr>${negrito ? '<w:b/>' : ''}<w:sz w:val="${tam}"/></w:rPr><w:t xml:space="preserve">${xmlEsc(txt)}</w:t></w:r>` : ''}</w:p>`;
function figura(rid, id, w, h) {
  return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="120" w:after="0"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${w}" cy="${h}"/><wp:docPr id="${id}" name="Imagem ${id}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="imagem${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}
/**
 * Acrescenta uma página "Anexo" ao .docx com o mapa e as fotos.
 * imagens: [{ bytes: Uint8Array, ext: 'jpg'|'png', w, h, legenda }]
 */
export async function anexarImagens(blob, titulo, imagens) {
  if (!imagens.length) return blob;
  const zip = new PizZip(await blob.arrayBuffer());
  let docXml = zip.file('word/document.xml').asText();
  let rels = zip.file('word/_rels/document.xml.rels').asText();
  let ct = zip.file('[Content_Types].xml').asText();
  for (const [ext, tipo] of [['jpg', 'image/jpeg'], ['png', 'image/png']]) if (!new RegExp(`Extension="${ext}"`, 'i').test(ct)) ct = ct.replace(/(<Types[^>]*>)/, `$1<Default Extension="${ext}" ContentType="${tipo}"/>`);
  let corpo = par(titulo, { negrito: true, centro: true, tam: 24, quebra: true });
  const base = Date.now() % 100000;
  imagens.forEach((img, i) => {
    const rid = 'rIdGab' + i, nome = `gab-anexo-${base}-${i}.${img.ext}`;
    zip.file('word/media/' + nome, img.bytes);
    rels = rels.replace('</Relationships>', `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${nome}"/></Relationships>`);
    // cabe na largura útil (15 cm) e no máximo 9,5 cm de altura: duas imagens por página
    const maxW = 15 * EMU_CM, maxH = 9.5 * EMU_CM; const k = Math.min(maxW / img.w, maxH / img.h);
    corpo += figura(rid, 9000 + i, Math.round(img.w * k), Math.round(img.h * k));
    if (img.legenda) corpo += par(img.legenda, { centro: true, tam: 18 });
  });
  const fim = docXml.lastIndexOf('<w:sectPr');
  const pos = fim > docXml.lastIndexOf('</w:p>') ? fim : docXml.lastIndexOf('</w:body>');
  docXml = docXml.slice(0, pos) + corpo + docXml.slice(pos);
  zip.file('word/document.xml', docXml); zip.file('word/_rels/document.xml.rels', rels); zip.file('[Content_Types].xml', ct);
  return zip.generate({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

/** Lê uma imagem (URL) e devolve JPEG reduzido para caber no Word. */
export async function imagemParaWord(url, maxLado = 1400) {
  const img = await carregarImg(url);
  const k = Math.min(1, maxLado / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  return { bytes: await canvasBytes(c, 'image/jpeg'), ext: 'jpg', w: c.width, h: c.height };
}
function carregarImg(url) {
  return new Promise((ok, erro) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = () => erro(new Error('imagem indisponível')); i.src = url; });
}
async function canvasBytes(c, tipo) { const b = await new Promise(r => c.toBlob(r, tipo, 0.85)); if (!b) throw new Error('falha ao converter imagem'); return new Uint8Array(await b.arrayBuffer()); }

/** Monta a imagem de um mapa (OpenStreetMap) com o alfinete no ponto. */
export async function imagemMapa(lat, lng, zoom = 17) {
  const W = 900, H = 560, T = 256;
  const n = 2 ** zoom, xg = (lng + 180) / 360 * n * T;
  const yg = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n * T;
  const x0 = xg - W / 2, y0 = yg - H / 2;
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = '#eee'; g.fillRect(0, 0, W, H);
  const tarefas = [];
  for (let tx = Math.floor(x0 / T); tx <= Math.floor((x0 + W) / T); tx++) for (let ty = Math.floor(y0 / T); ty <= Math.floor((y0 + H) / T); ty++) {
    const s = 'abc'[(tx + ty) % 3];
    tarefas.push(carregarImg(`https://${s}.tile.openstreetmap.org/${zoom}/${((tx % n) + n) % n}/${ty}.png`).then(img => g.drawImage(img, tx * T - x0, ty * T - y0)));
  }
  const res = await Promise.allSettled(tarefas);
  if (!res.some(r => r.status === 'fulfilled')) throw new Error('mapa indisponível');
  // alfinete
  const px = W / 2, py = H / 2;
  g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(px, py + 2, 9, 4, 0, 0, 7); g.fill();
  g.fillStyle = '#d32f2f'; g.strokeStyle = '#fff'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(px, py); g.bezierCurveTo(px - 6, py - 14, px - 18, py - 22, px - 18, py - 36); g.arc(px, py - 36, 18, Math.PI, 0); g.bezierCurveTo(px + 18, py - 22, px + 6, py - 14, px, py); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(px, py - 36, 7, 0, 7); g.fill();
  g.font = '13px Arial'; const cr = '© colaboradores do OpenStreetMap'; const tw = g.measureText(cr).width;
  g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(W - tw - 12, H - 22, tw + 12, 22); g.fillStyle = '#333'; g.fillText(cr, W - tw - 6, H - 7);
  return { bytes: await canvasBytes(c, 'image/png'), ext: 'png', w: W, h: H };
}
