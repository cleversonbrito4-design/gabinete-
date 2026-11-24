# Faz os modelos de Word de um novo cliente a partir dos modelos do sistema (public/modelos/),
# trocando o timbre da Câmara de Cascavel:
#   - cabeçalho: a imagem do timbre do cliente (se tiver) ou o texto {casa_legislativa} / {gabinete}
#   - rodapé: {endereco_gabinete} (preenchido com "Dados do gabinete")
#   - "Câmara Municipal de Cascavel" no texto vira "{casa_legislativa}"
# Uso: python3 scripts/modelos-cliente.py PASTA_SAIDA [timbre.png|jpg]
import sys, os, copy
import docx
from docx.shared import Pt, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH

TIPOS = ['oficio', 'requerimento', 'indicacao', 'mocao', 'projeto_lei', 'lideranca']
saida = sys.argv[1]
timbre = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None
os.makedirs(saida, exist_ok=True)
AQUI = os.path.dirname(os.path.abspath(__file__))


def limpar(parte):
    """Apaga tudo do cabeçalho/rodapé, deixando um parágrafo vazio."""
    el = parte._element
    for filho in list(el):
        el.remove(filho)
    # tira a imagem antiga do timbre do arquivo
    for rid, rel in list(parte.part.rels.items()):
        if rel.reltype.endswith('/image'):
            del parte.part.rels[rid]
    return parte.add_paragraph()


def texto(p, t, tam=10, negrito=False):
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(t)
    r.font.size = Pt(tam)
    r.bold = negrito
    return r


for t in TIPOS:
    d = docx.Document(os.path.join(AQUI, '..', 'public', 'modelos', t + '.docx'))
    sec = d.sections[0]
    p = limpar(sec.header)
    if timbre:
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        largura = sec.page_width - sec.left_margin - sec.right_margin
        p.add_run().add_picture(timbre, width=largura)
    else:
        texto(p, '{casa_legislativa}', 13, True)
        texto(sec.header.add_paragraph(), '{gabinete}', 11)
    texto(limpar(sec.footer), '{endereco_gabinete}', 8)
    for par in d.paragraphs:
        for r in par.runs:
            if 'Câmara Municipal de Cascavel' in r.text:
                r.text = r.text.replace('Câmara Municipal de Cascavel', '{casa_legislativa}')
            if 'Cascavel' in r.text:
                r.text = r.text.replace('Cascavel', '{cidade_gabinete}')
    d.save(os.path.join(saida, t + '.docx'))
    print('ok', t)
