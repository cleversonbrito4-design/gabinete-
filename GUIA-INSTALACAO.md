# Como colocar o sistema do gabinete no ar

O código já está pronto. Faltam só as contas, que precisam do seu e-mail. Tudo é gratuito.
Faça na ordem e, ao terminar cada parte, me mande o que está pedido em **"Me envie"**.

---

## Parte 1: GitHub, onde fica o código (3 min)

1. Abra **https://claude.ai/connect-github** e conecte (ou crie) sua conta do GitHub.
2. Abra **https://github.com/new**
   - Em *Repository name*, escreva: `gabinete`
   - Marque **Private**
   - Não marque mais nada e clique em **Create repository**.

**Me envie:** "repositório criado". Eu coloco o código lá.

---

## Parte 2: Supabase, que guarda o banco de dados e o login (5 min)

1. Abra **https://supabase.com/dashboard** e entre com a conta do GitHub (*Continue with GitHub*).
2. Clique em **New project**:
   - *Name*: `gabinete`
   - *Database Password*: clique em *Generate a password* e guarde a senha num lugar seguro.
   - *Region*: **South America (São Paulo)**
   - Clique em **Create new project** e espere uns 2 minutos.
3. No menu da esquerda, abra **SQL Editor**. Cole todo o conteúdo do arquivo `supabase/schema.sql`, que eu te mando junto, e clique em **Run**. Deve aparecer *Success*.
4. No menu da esquerda, abra **Authentication → Sign In / Providers**. Desligue **Allow new users to sign up**, para que só pessoas convidadas consigam entrar, e salve.
5. Abra **Project Settings → API Keys**, a engrenagem no fim do menu. Copie a **Publishable key**; se não aparecer, copie a chave **anon public**.
6. Abra **Project Settings → Data API** (ou **API**) e copie a **Project URL**, que é algo como `https://abcd.supabase.co`.

**Me envie:** a *Project URL* e a *Publishable key*. Essas duas são públicas por natureza e podem ser enviadas no chat.
**Nunca me envie** a senha do banco nem a chave *secret* / *service_role*.

---

## Parte 3: Vercel, que publica o site com endereço grátis (3 min)

Faça esta parte depois que eu avisar que o código está no GitHub.

1. Abra **https://vercel.com/signup** e escolha **Continue with GitHub**.
2. Clique em **Add New… → Project**, ache o repositório `gabinete` e clique em **Import**.
3. Não mude nada e clique em **Deploy**.
4. Em cerca de 1 minuto aparece o endereço do sistema, algo como `https://gabinete-xxxx.vercel.app`.
   Para escolher um nome melhor, vá em **Settings → Domains** e edite para `gabinete-seunome.vercel.app`.

**Me envie:** o endereço final.

---

## Parte 4: Convidar a equipe (2 min)

1. No Supabase, abra **Authentication → URL Configuration**. Em **Site URL**, cole o endereço da Vercel e salve.
2. Abra **Authentication → Users → Add user → Send invitation** e convide cada uma das 5 pessoas pelo e-mail.
3. Cada pessoa recebe um e-mail, clica no link, cria a senha e digita o nome. Pronto.

Se alguém esquecer a senha, é só clicar em **"Esqueci minha senha"** na tela de login.

---

## Parte 5 (opcional): Google Agenda (10 min)

Faça esta parte quando o sistema já estiver funcionando.

1. Abra **https://console.cloud.google.com** com a conta Google que gerencia a agenda do deputado.
2. No topo, clique no seletor de projetos → **Novo projeto** → nome `gabinete` → **Criar**.
3. Abra **https://console.cloud.google.com/apis/library/calendar-json.googleapis.com** e clique em **Ativar**.
4. Abra **https://console.cloud.google.com/auth/overview** e clique em **Começar**:
   - Nome do app: `Gabinete`; e-mail de suporte: o seu.
   - Público: **Externo**.
   - Conclua o assistente.
5. Em **Público** (*Audience*), na parte **Usuários de teste**, adicione o e-mail Google de cada assessor que vai sincronizar a agenda.
6. Em **Clientes** (*Clients*) → **Criar cliente**:
   - Tipo: **Aplicativo da Web**
   - Em **Origens JavaScript autorizadas**, adicione o endereço da Vercel, por exemplo `https://gabinete-seunome.vercel.app`.
   - Clique em **Criar** e copie o **ID do cliente**, que termina em `.apps.googleusercontent.com`.

**Me envie:** o ID do cliente. Ele também é público. Não envie a "chave secreta do cliente".

Quem for usar a sincronização precisa ter permissão de **"Fazer alterações nos eventos"** na agenda do deputado. Para isso, o deputado compartilha a agenda com o e-mail do assessor no Google Agenda: Configurações → Compartilhar com pessoas.

---

## Bom saber

- **Plano grátis do Supabase:** o projeto é pausado se ficar 7 dias sem nenhum acesso. Com uso diário isso não acontece; se acontecer, basta clicar em *Restore* no painel.
- **Backup:** em cada tela, o botão **Exportar** baixa uma planilha (CSV) que abre no Excel.
- **Domínio próprio** (ex.: `gabinetefulano.com.br`): custa cerca de R$ 40 por ano no registro.br e pode ser ligado depois em Vercel → Settings → Domains.
