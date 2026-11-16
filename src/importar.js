// Importação de planilhas (Excel .xlsx ou CSV) para um módulo.
import { MODS } from './schema.js';

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// nomes de coluna comuns em planilhas de gabinete → campo do sistema
const SINONIMOS = {
  nome: ['nome', 'nome completo', 'contato', 'pessoa', 'eleitor', 'cidadao'],
  telefone: ['telefone', 'fone', 'celular', 'whatsapp', 'whats', 'zap', 'tel', 'contato telefone', 'telefone whatsapp'],
  email: ['email', 'e mail', 'correio eletronico'],
  municipio: ['municipio', 'cidade'],
  bairro: ['bairro', 'localidade', 'bairro localidade', 'distrito'],
  endereco: ['endereco', 'rua', 'logradouro', 'endereco completo'],
  cep: ['cep'],
  uf: ['uf', 'estado'],
  nascimento: ['nascimento', 'data de nascimento', 'aniversario', 'data nascimento', 'dt nascimento'],
  cpf: ['cpf'],
  grupo: ['grupo', 'categoria', 'segmento'],
  tipo: ['tipo'],
  solicitante: ['solicitante', 'quem pediu', 'nome do solicitante', 'requerente', 'nome'],
  assunto: ['assunto', 'demanda', 'pedido', 'solicitacao'],
  descricao: ['descricao', 'detalhes'],
  obs: ['obs', 'observacao', 'observacoes', 'andamento'],
  status: ['status', 'situacao'],
  prazo: ['prazo', 'prazo de retorno'],
  servico: ['servico', 'assunto do oficio', 'assunto'],
  protocolo: ['protocolo', 'numero do oficio', 'n oficio', 'oficio', 'numero'],
  orgao: ['orgao', 'destino', 'secretaria'],
  destinatario: ['destinatario', 'autoridade'],
  titulo: ['titulo', 'compromisso', 'evento'],
  data: ['data', 'dia'],
  inicio: ['inicio', 'hora', 'horario', 'hora inicio'],
  fim: ['fim', 'termino', 'hora fim'],
  objeto: ['objeto', 'descricao da emenda'],
  beneficiario: ['beneficiario', 'entidade'],
  valor_pedido: ['valor pedido', 'valor solicitado', 'valor'],
  valor_indicado: ['valor indicado', 'valor aprovado'],
  ementa: ['ementa'],
};

/** Lê o arquivo e devolve { cabecalho: [...], linhas: [[...], ...] }. */
export async function lerArquivo(file) {
  const nome = file.name.toLowerCase();
  let rows;
  if (nome.endsWith('.xlsx')) {
    const { default: readXlsxFile } = await import('read-excel-file');
    rows = await readXlsxFile(file);
  } else if (nome.endsWith('.csv') || nome.endsWith('.txt')) {
    let txt = await file.text();
    if (txt.includes('�')) txt = new TextDecoder('windows-1252').decode(await file.arrayBuffer());
    rows = parseCsv(txt.replace(/^﻿/, ''));
  } else if (nome.endsWith('.xls')) {
    throw new Error('Esse é o formato antigo do Excel (.xls). No Excel, use Arquivo → Salvar como → "Pasta de Trabalho do Excel (.xlsx)" e envie de novo.');
  } else throw new Error('Envie uma planilha .xlsx (Excel) ou .csv.');
  rows = rows.filter(r => r && r.some(c => c != null && String(c).trim() !== ''));
  if (rows.length < 2) throw new Error('A planilha precisa ter uma linha de títulos e pelo menos uma linha de dados.');
  return { cabecalho: rows[0].map(c => String(c ?? '').trim()), linhas: rows.slice(1) };
}

function parseCsv(txt) {
  const first = txt.split(/\r?\n/)[0] || '';
  const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
  const out = []; let row = [], cell = '', q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) { if (c === '"') { if (txt[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true; else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && txt[i + 1] === '\n') i++; row.push(cell); out.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row); }
  return out;
}

/** Sugere, para cada coluna da planilha, o campo do sistema correspondente ('' = ignorar). */
export function sugerirMapa(mod, cabecalho) {
  const campos = [['status', 'Situação'], ...MODS[mod].fields.map(f => [f.k, f.l])];
  const usados = new Set();
  return cabecalho.map(h => {
    const n = norm(h); if (!n) return '';
    let achou = campos.find(([k, l]) => !usados.has(k) && (norm(l) === n || norm(k) === n));
    if (!achou) achou = campos.find(([k]) => !usados.has(k) && (SINONIMOS[k] || []).includes(n));
    if (!achou) achou = campos.find(([k, l]) => !usados.has(k) && n.length > 3 && (norm(l).startsWith(n) || n.startsWith(norm(l))));
    if (!achou) return '';
    usados.add(achou[0]); return achou[0];
  });
}

const pad = n => String(n).padStart(2, '0');
function paraData(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return v.getUTCFullYear() + '-' + pad(v.getUTCMonth() + 1) + '-' + pad(v.getUTCDate());
  if (typeof v === 'number' && v > 1000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 864e5)); return paraData(d); }
  const s = String(v).trim();
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (m) { let y = +m[3]; if (y < 100) y += y > 30 ? 1900 : 2000; return y + '-' + pad(m[2]) + '-' + pad(m[1]); }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s); if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})$/.exec(s); if (m) return '1900-' + pad(m[2]) + '-' + pad(m[1]); // só dia/mês (aniversário)
  return null;
}
function paraHora(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return pad(v.getUTCHours()) + ':' + pad(v.getUTCMinutes());
  if (typeof v === 'number' && v < 1) { const min = Math.round(v * 1440); return pad(Math.floor(min / 60)) + ':' + pad(min % 60); }
  const m = /(\d{1,2})[:hH](\d{2})?/.exec(String(v)); return m ? pad(m[1]) + ':' + pad(m[2] || 0) : null;
}
function paraNumero(v, inteiro) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return inteiro ? Math.round(v) : v;
  let s = String(v).replace(/[^\d,.-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s); return isNaN(n) ? null : (inteiro ? Math.round(n) : n);
}

/** Converte as linhas da planilha em registros prontos para gravar. */
export function montarRegistros(mod, linhas, mapa, autor) {
  const M = MODS[mod]; const tipos = Object.fromEntries(M.fields.map(f => [f.k, f]));
  const statusOk = new Map(M.statuses.map(s => [norm(s[0]), s[0]]));
  const agora = new Date().toISOString();
  const regs = []; let semObrig = 0;
  for (const l of linhas) {
    const r = {};
    mapa.forEach((k, i) => {
      if (!k) return; let v = l[i]; if (v == null || String(v).trim() === '') return;
      const f = tipos[k];
      if (k === 'status') { const s = statusOk.get(norm(v)); if (s) r.status = s; return; }
      if (f.type === 'date') v = paraData(v);
      else if (f.type === 'time') v = paraHora(v);
      else if (f.type === 'money') v = paraNumero(v, false);
      else if (f.type === 'number') v = paraNumero(v, true);
      else if (f.type === 'select') { const o = f.opts.find(x => norm(x) === norm(v)); v = o || String(v).trim(); }
      else if (k === 'uf') v = String(v).trim().toUpperCase().slice(0, 2);
      else v = (v instanceof Date ? paraData(v) : String(v).trim());
      if (v != null && v !== '') r[k] = r[k] ? r[k] + ' ' + v : v;
    });
    if (!Object.keys(r).length) continue;
    if (M.fields.some(f => f.req && !r[f.k])) { semObrig++; continue; }
    r.status = r.status || M.statuses[0][0];
    r.historico = [{ em: agora, txt: 'Importado de planilha', por: autor }];
    regs.push(r);
  }
  return { regs, semObrig };
}

/** Remove pessoas que já existem (mesmo nome e telefone, ou mesmo nome sem telefone). */
export function semDuplicados(mod, regs, existentes) {
  if (mod !== 'pessoas') return { regs, dup: 0 };
  const dig = t => String(t || '').replace(/\D/g, '').slice(-8);
  const chave = r => norm(r.nome) + '|' + dig(r.telefone);
  const vistos = new Set(existentes.map(chave));
  const out = []; let dup = 0;
  for (const r of regs) { const c = chave(r); if (vistos.has(c)) { dup++; continue; } vistos.add(c); out.push(r); }
  return { regs: out, dup };
}
