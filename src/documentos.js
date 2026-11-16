// Gera ofícios e indicações em Word (.docx) a partir de modelos.
// O modelo padrão fica em public/modelos/; o gabinete pode enviar o próprio
// modelo (feito no Word, com os campos entre chaves) pela tela "Minha conta".
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import * as store from './store.js';

export const TIPOS = { oficio: 'Ofício', indicacao: 'Indicação' };

export const CAMPOS = [
  ['numero', 'Número do documento (ex.: 045)'], ['ano', 'Ano'], ['data_extenso', 'Data por extenso (16 de novembro de 2026)'],
  ['cidade_gabinete', 'Cidade do gabinete'], ['destinatario', 'Destinatário'], ['orgao', 'Órgão'], ['destinatario_orgao', 'Destinatário e órgão juntos'],
  ['municipio_uf', 'Município do pedido'], ['assunto', 'Assunto / serviço'], ['local_texto', '", na Rua X, em Município" (indicação)'],
  ['texto', 'Texto do ofício / justificativa'], ['vocativo', 'Vocativo (Senhor(a) Secretário(a))'], ['solicitante', 'Quem pediu'],
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
