# Converte os documentos reais do gabinete (Câmara de Cascavel) em modelos com campos.
# Uso: python3 scripts/converter-modelos-camara.py ENTRADA.docx SAIDA.docx oficio|requerimento|indicacao [requerimento.docx]
import sys, copy, docx
from docx.text.paragraph import Paragraph
src, out = sys.argv[1], sys.argv[2]

def paras(d):
    return [Paragraph(el, d) for el in d.element.body.iterchildren() if el.tag.endswith('}p')]
def settext(p, t):
    rs = p.runs
    rs[0].text = t
    for r in rs[1:]: r.text = ''
def delete(p): p._element.getparent().remove(p._element)
def loop(body_ps, name):
    # 3 parágrafos: {#name} / {.} / {/name}, com a formatação do primeiro parágrafo do corpo
    first = body_ps[0]
    settext(first, '{.}')
    a = copy.deepcopy(first._element); b = copy.deepcopy(first._element)
    first._element.addprevious(a); first._element.addnext(b)
    settext(Paragraph(a, None), '{#' + name + '}'); settext(Paragraph(b, None), '{/' + name + '}')
    for p in body_ps[1:]: delete(p)

kind = sys.argv[3]
d = docx.Document(src); P = paras(d)
if kind == 'oficio':
    settext(P[0], 'OFÍCIO Nº {numero}/{ano} – {gabinete_maiusculo}')
    settext(P[1], '{cidade_gabinete}, {data_extenso}.')
    settext(P[2], '{destinatario}')
    settext(P[3], '{orgao}')
    settext(P[4], 'Assunto: {assunto}')
    settext(P[5], '{vocativo},')
    loop(P[6:9], 'paragrafos')
    settext(P[10], '{deputado_nome}'); settext(P[11], '{deputado_cargo}')
elif kind == 'requerimento':
    r = P[0].runs; r[1].text = '{numero_doc},'; r[2].text = ' DE '; r[3].text = '{ano}'
    settext(P[1], '(Proponente: {proponente})')
    settext(P[7], '{texto}')
    settext(P[10], '{cidade_gabinete}, {data_extenso}.')
    settext(P[14], '{deputado_nome}'); settext(P[15], '{deputado_cargo}')
    delete(P[19]); loop(P[20:24], 'justificativa')
elif kind == 'indicacao':
    r = P[0].runs; r[2].text = '{numero_doc},'; r[3].text = ' DE {ano}.'
    settext(P[6], '{texto}')
    r = P[8].runs; r[0].text = '{cidade_gabinete}, {data_extenso}'; r[1].text = r[2].text = r[3].text = ''
    # troca a tabela de 21 assinaturas pela assinatura do parlamentar (copiada do requerimento)
    req = docx.Document(sys.argv[4]); RP = paras(req)
    tbl = [el for el in d.element.body.iterchildren() if el.tag.endswith('}tbl')][0]
    for src_p in [RP[11], RP[12], RP[14], RP[15]]:
        el = copy.deepcopy(src_p._element); tbl.addprevious(el)
    tbl.getparent().remove(tbl)
    P = paras(d)
    for p in P:
        if p.text.strip() == 'Fão do Bolsonaro': settext(p, '{deputado_nome}')
        elif p.text.strip() == 'Vereador/PL': settext(p, '{deputado_cargo}')
    i = [k for k, p in enumerate(P) if p.text.strip() == 'Justificativa:'][0]
    body = [p for p in P[i+1:] if p.text.strip()]
    loop(body, 'justificativa')
d.save(out)
