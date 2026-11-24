// Kit de novo cliente: monta tudo o que um novo gabinete precisa a partir de uma "ficha".
//
// Uso:   npm run novo-cliente -- caminho/da/ficha.json
// Ficha: veja clientes/_ficha-exemplo.json (copie, preencha e rode).
//
// O que ele faz:
//   1. cria clientes/<pasta>/cliente.json (marca, cidade, dados do gabinete, banco)
//   2. acha o centro e a área da cidade no mapa e a lista de bairros (OpenStreetMap), se a internet deixar
//   3. faz os logos (ou usa os enviados), o ícone do celular e os modelos de Word com o timbre do cliente
//   4. gera saida/<pasta>/banco.sql (banco completo + administrador) — NÃO vai para o GitHub
//   5. gera o site pronto em saida/<pasta>/site/ e o zip saida/<pasta>/site.zip para arrastar na Netlify
//   6. escreve saida/<pasta>/PROXIMOS-PASSOS.txt
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const fichaArq = process.argv[2];
if (!fichaArq) { console.error('Uso: npm run novo-cliente -- ficha.json   (modelo em clientes/_ficha-exemplo.json)'); process.exit(1); }
const F = JSON.parse(fs.readFileSync(fichaArq, 'utf8'));
const FICHA_DIR = path.dirname(path.resolve(fichaArq));
const arq = p => (p ? path.resolve(FICHA_DIR, p) : '');

const semAc = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const slug = t => semAc(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

for (const k of ['marca', 'parlamentar', 'cargo', 'cidade', 'uf', 'email_admin']) if (!F[k]) { console.error(`Falta "${k}" na ficha.`); process.exit(1); }
const PASTA = F.pasta || slug(F.marca);
if (PASTA === 'fala-cascavel') { console.error('A pasta "fala-cascavel" é do gabinete do Fão. Escolha outro nome.'); process.exit(1); }
const UF = F.uf.toUpperCase();
const UF_NOME = { AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins' };
const COR = F.cor || '#257ebf';
const COR2 = F.cor2 || '#72a83b';
const DIR = path.join(RAIZ, 'clientes', PASTA);
const PUB = path.join(DIR, 'publico');
const OUT = path.join(RAIZ, 'saida', PASTA);
fs.mkdirSync(path.join(PUB, 'marca'), { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
const passo = t => console.log('\n▶ ' + t);
const aviso = [];

/* ---------- 2. mapa da cidade ---------- */
async function buscar(url) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 25000);
  try { const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'gabinete-kit/1.0', Accept: 'application/json' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  catch (e) { // sem acesso direto (ex.: atrás de proxy): tenta com o curl
    try { return JSON.parse(execFileSync('curl', ['-sf', '-m', '25', '-A', 'gabinete-kit/1.0', url]).toString()); } catch { throw e; }
  } finally { clearTimeout(tm); }
}
let mapa = F.mapa || null, bairros = F.bairros || [];
if (!mapa) {
  passo('Procurando a cidade no mapa (OpenStreetMap)…');
  try {
    const q = new URLSearchParams({ format: 'jsonv2', countrycodes: 'br', city: F.cidade, state: UF_NOME[UF] || UF, limit: '1' });
    const [c] = await buscar('https://nominatim.openstreetmap.org/search?' + q);
    if (!c) throw new Error('cidade não achada');
    const bb = c.boundingbox.map(Number);
    mapa = { centro: [+(+c.lat).toFixed(4), +(+c.lon).toFixed(4)], area: bb.map(n => +n.toFixed(2)) };
    console.log('  centro', mapa.centro.join(', '));
    if (!bairros.length) {
      try {
        const ov = `[out:json][timeout:25];area["name"="${F.cidade}"]["boundary"="administrative"]["admin_level"="8"]->.a;(node["place"~"suburb|neighbourhood"](area.a);way["place"~"suburb|neighbourhood"](area.a);relation["place"~"suburb|neighbourhood"](area.a););out tags;`;
        const j = await buscar('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(ov));
        bairros = [...new Set(j.elements.map(e => e.tags && e.tags.name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
        console.log(`  ${bairros.length} bairros achados`);
      } catch (e) { aviso.push('Não consegui baixar a lista de bairros (' + e.message + '). A tela "bairros sem atendimento" só mostra bairros com pedidos até alguém preencher "bairros" no cliente.json.'); }
    }
  } catch (e) { aviso.push('Não achei a cidade no mapa (' + e.message + '). O mapa abre no centro do Brasil até alguém preencher "mapa" no cliente.json.'); }
}

/* ---------- 1. cliente.json ---------- */
passo('Criando clientes/' + PASTA + '/cliente.json');
const ORGAOS_PADRAO = ['Gabinete do Prefeito', 'Secretaria Municipal de Administração', 'Secretaria Municipal de Agricultura', 'Secretaria Municipal de Assistência Social', 'Secretaria Municipal de Cultura', 'Secretaria Municipal de Educação', 'Secretaria Municipal de Esporte e Lazer', 'Secretaria Municipal de Finanças', 'Secretaria Municipal de Meio Ambiente', 'Secretaria Municipal de Obras', 'Secretaria Municipal de Planejamento', 'Secretaria Municipal de Saúde', 'Secretaria Municipal de Segurança Pública', 'Secretaria Municipal de Trânsito', 'Secretaria Municipal de Habitação', 'Secretaria Municipal de Serviços Urbanos', 'Procuradoria-Geral do Município', 'Defesa Civil', 'Guarda Municipal', 'PROCON'];
const casa = F.casa || `Câmara Municipal de ${F.cidade}`;
const cliente = {
  _leia: 'Configuração deste cliente. Mudou algo? Gere o site de novo: CLIENTE=' + PASTA + ' npm run build',
  marca: F.marca,
  site: F.site || '',
  hashtags: F.hashtags || ['#' + semAc(F.cidade).replace(/\s+/g, ''), '#' + semAc(F.marca).replace(/\s+/g, '')],
  gabinete: {
    nome: F.gabinete || `Gabinete do ${String(F.cargo).split('/')[0].trim()} ${F.parlamentar}`,
    parlamentar: F.parlamentar, cargo: F.cargo, casa,
    endereco: F.endereco || '', ultimo_oficio: String(F.ultimo_oficio ?? ''), ultima_lideranca: '',
  },
  cidade: F.cidade, uf: UF, estado: UF_NOME[UF] || '', ddd: String(F.ddd || ''),
  mapa: mapa || undefined,
  bairros, orgaos: F.orgaos || ORGAOS_PADRAO,
  supabase: { url: F.supabase_url || '', chave: F.supabase_chave || '' },
  app: { nome_completo: `${F.marca} – ${F.gabinete || 'Gabinete do ' + String(F.cargo).split('/')[0].trim() + ' ' + F.parlamentar}`, cor_fundo: '#07111c' },
};
fs.writeFileSync(path.join(DIR, 'cliente.json'), JSON.stringify(cliente, null, 2) + '\n');
if (!F.supabase_url) aviso.push('Ainda sem banco (Supabase). O site abre em "modo demonstração" até preencher "supabase" no cliente.json e gerar de novo.');

/* ---------- 3. marca ---------- */
passo('Fazendo logos e ícones');
const iniciais = semAc(F.marca).split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');
const svgImagem = (file, w, h) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${w} ${h}"><image width="${w}" height="${h}" href="data:image/${path.extname(file).slice(1).replace('jpg', 'jpeg')};base64,${fs.readFileSync(file).toString('base64')}"/></svg>`;
const balao = (c1, c2, txt) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><path fill="${c1}" d="M120 18c58 0 104 38 104 86s-46 86-104 86c-12 0-24-2-35-5l-49 29 12-45C26 154 16 130 16 104 16 56 62 18 120 18z"/><text x="120" y="128" text-anchor="middle" font-family="Archivo, Arial Black, Arial, sans-serif" font-weight="800" font-size="${txt.length > 1 ? 78 : 96}" fill="${c2}">${xml(txt)}</text></svg>`;
function logoTexto(corTexto) {
  const partes = F.marca.trim().split(/\s+/);
  const a = partes[0], b = partes.slice(1).join(' ');
  const w = 260 + Math.max(a.length, b.length) * 44;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 234"><g transform="translate(0,4) scale(0.94)">${balao(COR, '#fff', iniciais).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g>`
    + `<text x="250" y="${b ? 105 : 150}" font-family="Archivo, Arial Black, Arial, sans-serif" font-weight="800" font-size="88" fill="${corTexto}">${xml(a)}</text>`
    + (b ? `<text x="250" y="200" font-family="Archivo, Arial Black, Arial, sans-serif" font-weight="800" font-size="88" fill="${COR2}">${xml(b)}</text>` : '') + '</svg>';
}
async function medidas(file) {
  try { const out = execFileSync('python3', ['-c', 'import sys;from PIL import Image;i=Image.open(sys.argv[1]);print(i.width,i.height)', file]).toString().trim().split(' ').map(Number); return out; } catch { return [800, 260]; }
}
for (const [campo, destino, cor] of [['logo', 'fala-cascavel.svg', '#0d2236'], ['logo_branca', 'fala-cascavel-branca.svg', '#ffffff']]) {
  const f = arq(F[campo]);
  let svg;
  if (f && f.endsWith('.svg')) svg = fs.readFileSync(f, 'utf8');
  else if (f) { const [w, h] = await medidas(f); svg = svgImagem(f, w, h); }
  else if (campo === 'logo_branca' && F.logo) { const g = arq(F.logo); if (g.endsWith('.svg')) svg = fs.readFileSync(g, 'utf8'); else { const [w, h] = await medidas(g); svg = svgImagem(g, w, h); } aviso.push('Sem logo para fundo escuro ("logo_branca"): usei o mesmo logo. Confira se aparece bem no fundo escuro.'); }
  else svg = logoTexto(cor);
  fs.writeFileSync(path.join(PUB, 'marca', destino), svg);
}
const icone = arq(F.icone);
fs.writeFileSync(path.join(PUB, 'marca', 'mascote.svg'), icone && icone.endsWith('.svg') ? fs.readFileSync(icone, 'utf8') : balao(COR, '#fff', iniciais));
fs.copyFileSync(path.join(PUB, 'marca', 'fala-cascavel.svg'), path.join(PUB, 'marca', 'fala-cascavel-vertical.svg'));
// ícones PNG do celular (precisa do Playwright/Chromium; sem ele, avisa)
try {
  let pw; try { pw = await import('playwright'); } catch { pw = createRequire(import.meta.url)(process.env.NODE_PATH ? 'playwright' : 'playwright'); }
  const { chromium } = pw;
  const b = await chromium.launch();
  const pg = await b.newPage();
  const fonte = icone && !icone.endsWith('.svg') ? `data:image/png;base64,${fs.readFileSync(icone).toString('base64')}` : 'data:image/svg+xml;base64,' + Buffer.from(balao('#ffffff', COR, iniciais)).toString('base64');
  for (const [nome, tam, pad] of [['icon-192.png', 192, 0.12], ['icon-512.png', 512, 0.12], ['icon-maskable.png', 512, 0.22], ['apple-touch-icon.png', 180, 0.12], ['favicon-32.png', 32, 0.04]]) {
    await pg.setViewportSize({ width: tam, height: tam });
    await pg.setContent(`<body style="margin:0;background:${nome === 'favicon-32.png' ? 'transparent' : COR};display:grid;place-items:center;width:${tam}px;height:${tam}px"><img src="${fonte}" style="width:${Math.round(tam * (1 - 2 * pad))}px;height:${Math.round(tam * (1 - 2 * pad))}px;object-fit:contain"></body>`);
    await pg.waitForTimeout(150);
    await pg.screenshot({ path: path.join(PUB, nome), omitBackground: nome === 'favicon-32.png' });
  }
  await b.close();
} catch (e) { aviso.push('Não consegui gerar os ícones PNG do celular (' + e.message.split('\n')[0] + '). O site usa os do Fala Cascavel até alguém colocar icon-192.png, icon-512.png, icon-maskable.png, apple-touch-icon.png e favicon-32.png em clientes/' + PASTA + '/publico/.'); }

/* ---------- 3b. modelos de Word ---------- */
passo('Fazendo os modelos de Word com o timbre do cliente');
const timbre = arq(F.timbre);
execFileSync('python3', [path.join(RAIZ, 'scripts', 'modelos-cliente.py'), path.join(PUB, 'modelos'), timbre], { stdio: 'inherit' });
if (!timbre) aviso.push('Sem imagem de timbre: os modelos de Word saem com o nome da Câmara e do gabinete escritos no topo. Para usar o timbre oficial, coloque "timbre" na ficha (PNG ou JPG, largura da folha) e rode de novo, ou envie o modelo pela tela Administração → Modelos de Word.');

/* ---------- 4. banco ---------- */
passo('Gerando saida/' + PASTA + '/banco.sql');
const schema = fs.readFileSync(path.join(RAIZ, 'supabase', 'schema.sql'), 'utf8');
const email = String(F.email_admin).trim().toLowerCase().replace(/'/g, "''");
fs.writeFileSync(path.join(OUT, 'banco.sql'), `-- Banco do cliente ${F.marca}. Cole tudo no SQL Editor do Supabase e clique em Run.\n${schema}\n\n-- Administrador do gabinete (só ele libera ou remove e-mails da equipe)\ninsert into public.equipe (email, admin) values ('${email}', true) on conflict (email) do update set admin = true;\nupdate public.equipe set admin = (email = '${email}');\n`);

/* ---------- 5. site ---------- */
passo('Gerando o site');
const SITE_DIR = path.join(OUT, 'site');
execFileSync(process.execPath, [path.join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', SITE_DIR, '--emptyOutDir'], { cwd: RAIZ, stdio: 'inherit', env: { ...process.env, CLIENTE: PASTA } });
fs.writeFileSync(path.join(SITE_DIR, 'netlify.toml'), '[build]\n  command = "echo pronto"\n  publish = "."\n');
const zip = path.join(OUT, 'site.zip');
fs.rmSync(zip, { force: true });
execFileSync('zip', ['-qr', zip, '.'], { cwd: SITE_DIR });

/* ---------- 6. próximos passos ---------- */
const txt = `KIT DO CLIENTE: ${F.marca} (${F.cidade}–${UF})
Gerado em ${new Date().toLocaleString('pt-BR')}

ARQUIVOS
  clientes/${PASTA}/cliente.json   configuração (vai para o GitHub)
  clientes/${PASTA}/publico/       logos, ícones e modelos de Word
  saida/${PASTA}/banco.sql         banco completo + administrador (NÃO vai para o GitHub)
  saida/${PASTA}/site.zip          site pronto para arrastar na Netlify

PRÓXIMOS PASSOS
  1. Supabase: novo projeto (região São Paulo) → SQL Editor → colar banco.sql → Run.
  2. Supabase → Authentication → Sign In / Providers: deixe LIGADO "Allow new users to sign up".
     (Qualquer um pode criar conta, mas só vê dados quem está na equipe.)
  3. Copiar Project URL e Publishable key para "supabase" em clientes/${PASTA}/cliente.json
     e rodar de novo:  npm run novo-cliente -- ${fichaArq}
     (ou preencher supabase_url e supabase_chave na ficha).
  4. Netlify → Add new project → Deploy manually → arrastar site.zip.
  5. Domínio: Netlify → Domain management → Add domain (${F.site || 'domínio do cliente'}).
     No Registro.br: A @ 75.2.60.5  e  CNAME www → <site>.netlify.app
  6. Supabase → Authentication → URL Configuration: Site URL = https://${F.site || '<domínio>'}
     e em Redirect URLs, o mesmo endereço e o .netlify.app.
  7. O administrador (${F.email_admin}) abre o site → "Primeiro acesso? Criar minha conta".
     Depois ele libera a equipe em Administração.
${aviso.length ? '\nATENÇÃO\n' + aviso.map(a => '  • ' + a).join('\n') + '\n' : ''}`;
fs.writeFileSync(path.join(OUT, 'PROXIMOS-PASSOS.txt'), txt);
console.log('\n' + txt);
