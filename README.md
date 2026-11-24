# Gestão do Gabinete

Sistema web para a equipe de um gabinete parlamentar registrar:

- **Demandas** (atendimentos), com solicitante, município, prioridade, responsável e prazo de retorno
- **Ofícios e serviços** enviados a órgãos, com protocolo e prazo de resposta
- **Emendas**, do pedido ao pagamento, com valores pedidos e indicados
- **Proposituras**: projetos de lei, indicações, requerimentos e moções
- **Agenda do deputado**, com sincronização opcional com o Google Agenda
- **Ofícios e indicações em Word (.docx)**, gerados a partir dos registros, com numeração automática e modelo editável pelo gabinete
- **Pessoas**: eleitores, lideranças e entidades, com aniversários, botão de WhatsApp e **etiquetas** de correspondência (Pimaco)

Também tem painel com prazos vencidos, aniversariantes e emendas por situação, histórico de mudanças em cada registro, atualização em tempo real entre os usuários e exportação para Excel (CSV).

## Tecnologia

- Front-end: Vite + JavaScript, sem framework, hospedado na Vercel
- Banco e login: Supabase (Postgres com Row Level Security: só usuários logados acessam)
- Google Agenda: Google Identity Services + Calendar API, chamados direto do navegador

## Instalação

Veja o [GUIA-INSTALACAO.md](GUIA-INSTALACAO.md), um passo a passo para quem não é programador.

## Desenvolvimento

```bash
npm install
npm run dev        # sem .env roda em "modo demonstração" (dados só no navegador)
npm run build
npm run sql        # regenera supabase/schema.sql a partir de src/schema.js
python3 scripts/gen-modelos.py   # regenera os modelos padrão de Word (requer python-docx)
```

Para incluir ou alterar campos, edite `src/schema.js`, rode `npm run sql` e execute o `supabase/schema.sql` de novo no SQL Editor do Supabase. O script é idempotente e só acrescenta o que falta.

## Vários gabinetes (clientes)

Cada gabinete tem uma pasta em `clientes/<nome>/`:

- `cliente.json`: marca, site, cidade, UF, DDD, dados do gabinete, bairros, órgãos da prefeitura e banco (Supabase).
- `publico/` (opcional): arquivos que substituem os de `public/` só para esse cliente (logos em `marca/`, ícones, modelos de Word em `modelos/`).

Gerar o site de um cliente: `CLIENTE=<nome> npm run build`. Sem `CLIENTE`, sai o Fala Cascavel (`clientes/fala-cascavel`).

Novo cliente do zero: copie `clientes/_ficha-exemplo.json`, preencha e rode `npm run novo-cliente -- minha-ficha.json`.
Ele cria a pasta do cliente, os logos, os ícones, os modelos de Word com o timbre dele, o `saida/<nome>/banco.sql`
(banco + administrador; fica fora do Git) e o `saida/<nome>/site.zip` para arrastar na Netlify.
O passo a passo aparece em `saida/<nome>/PROXIMOS-PASSOS.txt`.
