// Modelos de etiquetas adesivas (medidas em milímetros, conforme o fabricante).
export const MODELOS = {
  '6180': { nome: 'Pimaco 6180 / 6280 – Carta, 30 por folha', page: [215.9, 279.4], cols: 3, rows: 10, w: 66.7, h: 25.4, top: 12.7, left: 4.8, gapX: 3.2, gapY: 0 },
  '6181': { nome: 'Pimaco 6181 / 6281 – Carta, 20 por folha', page: [215.9, 279.4], cols: 2, rows: 10, w: 101.6, h: 25.4, top: 12.7, left: 4.0, gapX: 4.8, gapY: 0 },
  'A4256': { nome: 'Pimaco A4256 / A4356 – A4, 33 por folha', page: [210, 297], cols: 3, rows: 11, w: 63.5, h: 25.4, top: 8.8, left: 7.2, gapX: 2.5, gapY: 0 },
  'A4255': { nome: 'Pimaco A4255 / A4355 – A4, 21 por folha', page: [210, 297], cols: 3, rows: 7, w: 63.5, h: 38.1, top: 15.15, left: 7.2, gapX: 2.5, gapY: 0 },
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function linhas(p) {
  const cid = [p.municipio, p.uf].filter(Boolean).join(' – ');
  return [
    `<b>${esc([p.tratamento, p.nome].filter(Boolean).join(' '))}</b>`,
    esc(p.endereco || ''),
    esc(p.bairro || ''),
    esc([p.cep && ('CEP ' + p.cep), cid].filter(Boolean).join('  ')),
  ].filter(Boolean).join('<br>');
}

/** Monta as folhas de etiquetas. `pular` deixa as primeiras posições em branco (folha já usada). */
export function folhas(pessoas, modelo, pular = 0, guias = true) {
  const M = MODELOS[modelo];
  const porFolha = M.cols * M.rows;
  const itens = Array(pular).fill(null).concat(pessoas);
  const out = [];
  for (let i = 0; i < Math.max(itens.length, 1); i += porFolha) {
    const pag = itens.slice(i, i + porFolha);
    const lbls = pag.map((p, j) => {
      if (!p) return '';
      const c = j % M.cols, r = Math.floor(j / M.cols);
      const x = M.left + c * (M.w + M.gapX), y = M.top + r * (M.h + M.gapY);
      return `<div class="lbl" style="left:${x}mm;top:${y}mm;width:${M.w}mm;height:${M.h}mm">${linhas(p)}</div>`;
    }).join('');
    out.push(`<div class="sheet ${guias ? 'guides' : ''}" style="width:${M.page[0]}mm;height:${M.page[1]}mm">${lbls}</div>`);
  }
  return { html: out.join(''), css: `@page{size:${M.page[0]}mm ${M.page[1]}mm;margin:0}` };
}
