// Cada gabinete (cliente) tem uma pasta em clientes/<nome>/ com:
//   cliente.json  -> nome da marca, site, cidade, dados do gabinete, banco (Supabase)
//   publico/      -> (opcional) arquivos que substituem os de public/: logos, ícones, modelos de Word
// Para gerar o site de um cliente:  CLIENTE=<nome> npm run build
// Sem CLIENTE, usa o Fala Cascavel (gabinete do vereador Fão do Bolsonaro).
import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const SLUG = process.env.CLIENTE || 'fala-cascavel';
const DIR = path.resolve('clientes', SLUG);
if (!fs.existsSync(path.join(DIR, 'cliente.json'))) throw new Error(`Cliente "${SLUG}" não encontrado: falta clientes/${SLUG}/cliente.json`);
const CLI = JSON.parse(fs.readFileSync(path.join(DIR, 'cliente.json'), 'utf8'));
delete CLI._leia;
const PUB = path.join(DIR, 'publico');
const MARCA = CLI.marca || 'Gestão do Gabinete';
const FUNDO = (CLI.app && CLI.app.cor_fundo) || '#07111c';

function manifesto() {
  return JSON.stringify({
    name: (CLI.app && CLI.app.nome_completo) || `${MARCA} – ${(CLI.gabinete && CLI.gabinete.nome) || ''}`,
    short_name: MARCA,
    description: 'Demandas, ofícios, emendas, proposituras, agenda e pessoas do gabinete.',
    lang: 'pt-BR', start_url: '/#painel', scope: '/', display: 'standalone',
    background_color: FUNDO, theme_color: FUNDO,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, null, 2) + '\n';
}

function copiar(de, para) {
  for (const n of fs.readdirSync(de)) {
    const a = path.join(de, n), b = path.join(para, n);
    if (fs.statSync(a).isDirectory()) { fs.mkdirSync(b, { recursive: true }); copiar(a, b); } else fs.copyFileSync(a, b);
  }
}

function cliente() {
  let outDir = 'dist';
  return {
    name: 'gabinete-cliente',
    config: () => ({ define: { __CLIENTE__: JSON.stringify(CLI) } }),
    configResolved(c) { outDir = c.build.outDir; },
    transformIndexHtml: html => html
      .replace(/<title>[^<]*<\/title>/, `<title>${MARCA}</title>`)
      .replace(/(apple-mobile-web-app-title" content=")[^"]*/, `$1${MARCA}`)
      .replace(/#07111c/g, FUNDO),
    // no "npm run dev": arquivos do cliente têm prioridade sobre public/
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const u = decodeURIComponent((req.url || '').split('?')[0]);
        if (u === '/manifest.webmanifest') { res.setHeader('Content-Type', 'application/manifest+json'); return res.end(manifesto()); }
        const f = path.join(PUB, u);
        if (u !== '/' && f.startsWith(PUB) && fs.existsSync(f) && fs.statSync(f).isFile()) return res.end(fs.readFileSync(f));
        next();
      });
    },
    writeBundle() {
      if (fs.existsSync(PUB)) copiar(PUB, outDir);
      fs.writeFileSync(path.join(outDir, 'manifest.webmanifest'), manifesto());
      const sw = path.join(outDir, 'sw.js');
      if (fs.existsSync(sw)) fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace(/'Fala Cascavel'/g, `'${MARCA.replace(/['\\]/g, '\\$&')}'`));
      console.log(`\n✓ Site gerado para o cliente "${SLUG}" (${MARCA})`);
    },
  };
}

export default defineConfig({ plugins: [cliente()] });
