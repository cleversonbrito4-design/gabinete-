# Gera os modelos padrão de Word (public/modelos/*.docx). Uso: python3 scripts/gen-modelos.py
# Os campos entre {chaves} são preenchidos pelo sistema.
from docx import Document
from docx.shared import Pt, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH

def base():
    d = Document()
    s = d.sections[0]
    s.page_width, s.page_height = Cm(21), Cm(29.7)
    s.left_margin = s.right_margin = Cm(3); s.top_margin = Cm(2.5); s.bottom_margin = Cm(2)
    st = d.styles['Normal']; st.font.name = 'Times New Roman'; st.font.size = Pt(12)
    st.paragraph_format.space_after = Pt(6)
    h = s.header.paragraphs[0]; h.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = h.add_run('{gabinete}'); r.bold = True; r.font.size = Pt(13)
    h2 = s.header.add_paragraph('{casa_legislativa}'); h2.alignment = WD_ALIGN_PARAGRAPH.CENTER
    f = s.footer.paragraphs[0]; f.alignment = WD_ALIGN_PARAGRAPH.CENTER
    rf = f.add_run('{endereco_gabinete}'); rf.font.size = Pt(9)
    return d

def p(d, text='', bold=False, align=None, indent=False, size=None):
    para = d.add_paragraph(); r = para.add_run(text); r.bold = bold
    if size: r.font.size = Pt(size)
    if align is not None: para.alignment = align
    if indent: para.paragraph_format.first_line_indent = Cm(2.5)
    return para

J = WD_ALIGN_PARAGRAPH.JUSTIFY; C = WD_ALIGN_PARAGRAPH.CENTER; R = WD_ALIGN_PARAGRAPH.RIGHT

# ---- Ofício
d = base()
p(d, 'Ofício nº {numero}/{ano} – GAB', bold=True)
p(d, '{cidade_gabinete}, {data_extenso}.', align=R)
p(d)
p(d, 'A Sua Senhoria o(a) Senhor(a)')
p(d, '{destinatario}', bold=True)
p(d, '{orgao}')
p(d, '{municipio_uf}')
p(d)
p(d, 'Assunto: {assunto}', bold=True)
p(d)
p(d, '{vocativo},', indent=True)
p(d, '{texto}', align=J, indent=True)
p(d, 'Certo de contar com a atenção de Vossa Senhoria, renovo protestos de elevada estima e consideração.', align=J, indent=True)
p(d); p(d)
p(d, 'Atenciosamente,', align=C)
p(d); p(d)
p(d, '{deputado_nome}', bold=True, align=C)
p(d, '{deputado_cargo}', align=C)
d.save('public/modelos/oficio.docx')

# ---- Indicação
d = base()
p(d, 'INDICAÇÃO Nº {numero}/{ano}', bold=True, align=C, size=13)
p(d)
p(d, 'O {deputado_cargo} que esta subscreve, no uso de suas atribuições regimentais, INDICA ao(à) {destinatario_orgao}, a necessidade de {assunto}{local_texto}.', align=J, indent=True)
p(d)
p(d, 'JUSTIFICATIVA', bold=True, align=C)
p(d, '{texto}', align=J, indent=True)
p(d, 'Diante do exposto, solicito o encaminhamento desta Indicação ao órgão competente.', align=J, indent=True)
p(d)
p(d, '{cidade_gabinete}, {data_extenso}.', align=R)
p(d); p(d)
p(d, '{deputado_nome}', bold=True, align=C)
p(d, '{deputado_cargo}', align=C)
d.save('public/modelos/indicacao.docx')
print('ok')
