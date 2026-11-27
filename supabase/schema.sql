-- Gerado por scripts/gen-sql.mjs. Cole no SQL Editor do Supabase e clique em Run.
-- Pode rodar de novo com segurança: só cria o que ainda não existe.

-- Equipe: só e-mails desta lista acessam os dados (mesmo que alguém crie conta)
create table if not exists public.equipe (
  email text primary key check (email = lower(email)),
  criado_em timestamptz not null default now()
);
create or replace function public.is_equipe() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.equipe where email = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;
revoke all on function public.is_equipe() from public, anon;
grant execute on function public.is_equipe() to authenticated;
alter table public.equipe enable row level security;

-- Administrador: só ele inclui ou remove e-mails da equipe.
-- Na primeira vez, o administrador é o primeiro e-mail cadastrado na lista.
alter table public.equipe add column if not exists admin boolean not null default false;
update public.equipe set admin = true
  where email = (select email from public.equipe order by criado_em, email limit 1)
    and not exists (select 1 from public.equipe where admin);
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.equipe where admin and email = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
drop policy if exists "equipe gerencia equipe" on public.equipe;
drop policy if exists "equipe ve equipe" on public.equipe;
create policy "equipe ve equipe" on public.equipe for select to authenticated using (public.is_equipe());
drop policy if exists "admin inclui na equipe" on public.equipe;
create policy "admin inclui na equipe" on public.equipe for insert to authenticated with check (public.is_admin());
drop policy if exists "admin altera equipe" on public.equipe;
create policy "admin altera equipe" on public.equipe for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin remove da equipe" on public.equipe;
create policy "admin remove da equipe" on public.equipe for delete to authenticated using (public.is_admin() and email <> lower(coalesce(auth.jwt() ->> 'email', '')));

create table if not exists public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  criado_em timestamptz not null default now()
);
alter table public.perfis enable row level security;
drop policy if exists "equipe le perfis" on public.perfis;
create policy "equipe le perfis" on public.perfis for select to authenticated using (public.is_equipe());
drop policy if exists "cada um grava o seu perfil" on public.perfis;
create policy "cada um grava o seu perfil" on public.perfis for all to authenticated using (id = auth.uid() and public.is_equipe()) with check (id = auth.uid() and public.is_equipe());

create table if not exists public.config (
  id text primary key,
  valor jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);
alter table public.config enable row level security;
-- toda a equipe lê; as configurações do sistema (dados do gabinete, mensagens, modelos de Word…) só o administrador muda.
-- "geo" (posições do mapa) e "backup" (data da última cópia) a equipe toda grava.
drop policy if exists "equipe acessa config" on public.config;
drop policy if exists "equipe le config" on public.config;
create policy "equipe le config" on public.config for select to authenticated using (public.is_equipe());
drop policy if exists "grava config" on public.config;
drop policy if exists "inclui config" on public.config;
create policy "inclui config" on public.config for insert to authenticated with check (public.is_equipe() and (id in ('geo', 'backup') or public.is_admin()));
drop policy if exists "altera config" on public.config;
create policy "altera config" on public.config for update to authenticated using (public.is_equipe() and (id in ('geo', 'backup') or public.is_admin())) with check (public.is_equipe() and (id in ('geo', 'backup') or public.is_admin()));
drop policy if exists "apaga config" on public.config;
create policy "apaga config" on public.config for delete to authenticated using (public.is_admin());

-- Registro de acessos: cada colaborador grava o próprio acesso; só o administrador consulta.
create table if not exists public.acessos (
  id bigint generated always as identity primary key,
  email text not null,
  em timestamptz not null default now(),
  aparelho text
);
create index if not exists acessos_email_em on public.acessos (email, em desc);
alter table public.acessos enable row level security;
drop policy if exists "admin ve acessos" on public.acessos;
create policy "admin ve acessos" on public.acessos for select to authenticated using (public.is_admin());
create or replace function public.registrar_acesso(p_aparelho text) returns void
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if not public.is_equipe() then return; end if;
  -- no máximo um registro a cada 10 minutos por pessoa
  if exists (select 1 from public.acessos where email = v_email and em > now() - interval '10 minutes') then return; end if;
  insert into public.acessos (email, aparelho) values (v_email, left(coalesce(p_aparelho, ''), 80));
  delete from public.acessos where email = v_email and em < now() - interval '1 year';
end $$;
revoke all on function public.registrar_acesso(text) from public, anon;
grant execute on function public.registrar_acesso(text) to authenticated;

-- Painel do administrador: último login de cada colaborador (dados do login do Supabase).
create or replace function public.admin_usuarios() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Só o administrador pode ver esta tela.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'email', e.email, 'admin', e.admin, 'liberado_em', e.criado_em,
      'nome', (select p.nome from public.perfis p where p.id = u.id),
      'conta_criada', u.created_at, 'ultimo_login', u.last_sign_in_at,
      'ultimo_acesso', (select max(a.em) from public.acessos a where a.email = e.email),
      'acessos_30d', (select count(*) from public.acessos a where a.email = e.email and a.em > now() - interval '30 days'))
    order by e.admin desc, e.email)
    from public.equipe e left join auth.users u on lower(u.email) = e.email), '[]'::jsonb);
end $$;
revoke all on function public.admin_usuarios() from public, anon;
grant execute on function public.admin_usuarios() to authenticated;

create or replace function public.tocar_atualizado_em() returns trigger language plpgsql as $$
begin new.atualizado_em = now(); return new; end $$;

-- Demandas
create table if not exists public.demandas (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'Nova',
  categoria text,
  tipo_doc text,
  assunto text,
  solicitante text,
  telefone text,
  municipio text,
  bairro text,
  area text,
  prioridade text,
  responsavel text,
  prazo date,
  origem text,
  descricao text,
  obs text,
  publico boolean not null default false,
  lat double precision,
  lng double precision,
  avaliacao_token uuid default gen_random_uuid(),
  nota integer,
  nota_comentario text,
  nota_em timestamptz,
  historico jsonb not null default '[]'::jsonb,
  anexos jsonb not null default '[]'::jsonb,
  criado_por uuid references auth.users(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.demandas add column if not exists categoria text;
alter table public.demandas add column if not exists tipo_doc text;
alter table public.demandas add column if not exists assunto text;
alter table public.demandas add column if not exists solicitante text;
alter table public.demandas add column if not exists telefone text;
alter table public.demandas add column if not exists municipio text;
alter table public.demandas add column if not exists bairro text;
alter table public.demandas add column if not exists area text;
alter table public.demandas add column if not exists prioridade text;
alter table public.demandas add column if not exists responsavel text;
alter table public.demandas add column if not exists prazo date;
alter table public.demandas add column if not exists origem text;
alter table public.demandas add column if not exists descricao text;
alter table public.demandas add column if not exists obs text;
alter table public.demandas add column if not exists publico boolean not null default false;
alter table public.demandas add column if not exists lat double precision;
alter table public.demandas add column if not exists lng double precision;
alter table public.demandas add column if not exists avaliacao_token uuid default gen_random_uuid();
alter table public.demandas add column if not exists nota integer;
alter table public.demandas add column if not exists nota_comentario text;
alter table public.demandas add column if not exists nota_em timestamptz;
alter table public.demandas add column if not exists anexos jsonb not null default '[]'::jsonb;
alter table public.demandas enable row level security;
drop policy if exists "equipe acessa demandas" on public.demandas;
create policy "equipe acessa demandas" on public.demandas for all to authenticated using (public.is_equipe()) with check (public.is_equipe());
drop trigger if exists demandas_atualizado_em on public.demandas;
create trigger demandas_atualizado_em before update on public.demandas for each row execute function public.tocar_atualizado_em();

-- Ofícios e serviços
create table if not exists public.servicos (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'Recebida',
  servico text,
  solicitante text,
  telefone text,
  municipio text,
  local text,
  orgao text,
  destinatario text,
  tipo_doc text,
  protocolo text,
  data_envio date,
  prazo date,
  responsavel text,
  vocativo text,
  corpo text,
  obs text,
  publico boolean not null default false,
  demanda_id uuid,
  lat double precision,
  lng double precision,
  historico jsonb not null default '[]'::jsonb,
  anexos jsonb not null default '[]'::jsonb,
  criado_por uuid references auth.users(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.servicos add column if not exists servico text;
alter table public.servicos add column if not exists solicitante text;
alter table public.servicos add column if not exists telefone text;
alter table public.servicos add column if not exists municipio text;
alter table public.servicos add column if not exists local text;
alter table public.servicos add column if not exists orgao text;
alter table public.servicos add column if not exists destinatario text;
alter table public.servicos add column if not exists tipo_doc text;
alter table public.servicos add column if not exists protocolo text;
alter table public.servicos add column if not exists data_envio date;
alter table public.servicos add column if not exists prazo date;
alter table public.servicos add column if not exists responsavel text;
alter table public.servicos add column if not exists vocativo text;
alter table public.servicos add column if not exists corpo text;
alter table public.servicos add column if not exists obs text;
alter table public.servicos add column if not exists publico boolean not null default false;
alter table public.servicos add column if not exists demanda_id uuid;
alter table public.servicos add column if not exists lat double precision;
alter table public.servicos add column if not exists lng double precision;
alter table public.servicos add column if not exists anexos jsonb not null default '[]'::jsonb;
alter table public.servicos enable row level security;
drop policy if exists "equipe acessa servicos" on public.servicos;
create policy "equipe acessa servicos" on public.servicos for all to authenticated using (public.is_equipe()) with check (public.is_equipe());
drop trigger if exists servicos_atualizado_em on public.servicos;
create trigger servicos_atualizado_em before update on public.servicos for each row execute function public.tocar_atualizado_em();

-- Emendas
create table if not exists public.emendas (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'Pedido recebido',
  objeto text,
  beneficiario text,
  cnpj text,
  municipio text,
  area text,
  modalidade text,
  valor_pedido numeric(14,2),
  valor_indicado numeric(14,2),
  valor_empenhado numeric(14,2),
  valor_pago numeric(14,2),
  exercicio integer,
  quem_pediu text,
  numero text,
  obs text,
  publico boolean not null default false,
  historico jsonb not null default '[]'::jsonb,
  anexos jsonb not null default '[]'::jsonb,
  criado_por uuid references auth.users(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.emendas add column if not exists objeto text;
alter table public.emendas add column if not exists beneficiario text;
alter table public.emendas add column if not exists cnpj text;
alter table public.emendas add column if not exists municipio text;
alter table public.emendas add column if not exists area text;
alter table public.emendas add column if not exists modalidade text;
alter table public.emendas add column if not exists valor_pedido numeric(14,2);
alter table public.emendas add column if not exists valor_indicado numeric(14,2);
alter table public.emendas add column if not exists valor_empenhado numeric(14,2);
alter table public.emendas add column if not exists valor_pago numeric(14,2);
alter table public.emendas add column if not exists exercicio integer;
alter table public.emendas add column if not exists quem_pediu text;
alter table public.emendas add column if not exists numero text;
alter table public.emendas add column if not exists obs text;
alter table public.emendas add column if not exists publico boolean not null default false;
alter table public.emendas add column if not exists anexos jsonb not null default '[]'::jsonb;
alter table public.emendas enable row level security;
drop policy if exists "equipe acessa emendas" on public.emendas;
create policy "equipe acessa emendas" on public.emendas for all to authenticated using (public.is_equipe()) with check (public.is_equipe());
drop trigger if exists emendas_atualizado_em on public.emendas;
create trigger emendas_atualizado_em before update on public.emendas for each row execute function public.tocar_atualizado_em();

-- Proposituras
create table if not exists public.proposituras (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'Em elaboração',
  ementa text,
  tipo text,
  numero text,
  ano integer,
  data_protocolo date,
  coautores text,
  comissao text,
  tema text,
  destinatario text,
  orgao text,
  link text,
  texto text,
  corpo text,
  obs text,
  historico jsonb not null default '[]'::jsonb,
  anexos jsonb not null default '[]'::jsonb,
  criado_por uuid references auth.users(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.proposituras add column if not exists ementa text;
alter table public.proposituras add column if not exists tipo text;
alter table public.proposituras add column if not exists numero text;
alter table public.proposituras add column if not exists ano integer;
alter table public.proposituras add column if not exists data_protocolo date;
alter table public.proposituras add column if not exists coautores text;
alter table public.proposituras add column if not exists comissao text;
alter table public.proposituras add column if not exists tema text;
alter table public.proposituras add column if not exists destinatario text;
alter table public.proposituras add column if not exists orgao text;
alter table public.proposituras add column if not exists link text;
alter table public.proposituras add column if not exists texto text;
alter table public.proposituras add column if not exists corpo text;
alter table public.proposituras add column if not exists obs text;
alter table public.proposituras add column if not exists anexos jsonb not null default '[]'::jsonb;
alter table public.proposituras enable row level security;
drop policy if exists "equipe acessa proposituras" on public.proposituras;
create policy "equipe acessa proposituras" on public.proposituras for all to authenticated using (public.is_equipe()) with check (public.is_equipe());
drop trigger if exists proposituras_atualizado_em on public.proposituras;
create trigger proposituras_atualizado_em before update on public.proposituras for each row execute function public.tocar_atualizado_em();

-- Agenda
create table if not exists public.agenda (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'A confirmar',
  titulo text,
  data date,
  tipo text,
  inicio time,
  fim time,
  local text,
  municipio text,
  contato text,
  acompanha text,
  pauta text,
  google_event_id text,
  historico jsonb not null default '[]'::jsonb,
  anexos jsonb not null default '[]'::jsonb,
  criado_por uuid references auth.users(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.agenda add column if not exists titulo text;
alter table public.agenda add column if not exists data date;
alter table public.agenda add column if not exists tipo text;
alter table public.agenda add column if not exists inicio time;
alter table public.agenda add column if not exists fim time;
alter table public.agenda add column if not exists local text;
alter table public.agenda add column if not exists municipio text;
alter table public.agenda add column if not exists contato text;
alter table public.agenda add column if not exists acompanha text;
alter table public.agenda add column if not exists pauta text;
alter table public.agenda add column if not exists google_event_id text;
alter table public.agenda add column if not exists anexos jsonb not null default '[]'::jsonb;
alter table public.agenda enable row level security;
drop policy if exists "equipe acessa agenda" on public.agenda;
create policy "equipe acessa agenda" on public.agenda for all to authenticated using (public.is_equipe()) with check (public.is_equipe());
drop trigger if exists agenda_atualizado_em on public.agenda;
create trigger agenda_atualizado_em before update on public.agenda for each row execute function public.tocar_atualizado_em();

-- Tarefas
create table if not exists public.tarefas (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'A fazer',
  titulo text,
  responsavel text,
  prazo date,
  prioridade text,
  relacionado text,
  descricao text,
  historico jsonb not null default '[]'::jsonb,
  anexos jsonb not null default '[]'::jsonb,
  criado_por uuid references auth.users(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.tarefas add column if not exists titulo text;
alter table public.tarefas add column if not exists responsavel text;
alter table public.tarefas add column if not exists prazo date;
alter table public.tarefas add column if not exists prioridade text;
alter table public.tarefas add column if not exists relacionado text;
alter table public.tarefas add column if not exists descricao text;
alter table public.tarefas add column if not exists anexos jsonb not null default '[]'::jsonb;
alter table public.tarefas enable row level security;
drop policy if exists "equipe acessa tarefas" on public.tarefas;
create policy "equipe acessa tarefas" on public.tarefas for all to authenticated using (public.is_equipe()) with check (public.is_equipe());
drop trigger if exists tarefas_atualizado_em on public.tarefas;
create trigger tarefas_atualizado_em before update on public.tarefas for each row execute function public.tocar_atualizado_em();

-- Recepção
create table if not exists public.recepcao (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'Aguardando',
  nome text,
  telefone text,
  motivo text,
  hora_chegada time,
  atendente text,
  bairro text,
  obs text,
  historico jsonb not null default '[]'::jsonb,
  anexos jsonb not null default '[]'::jsonb,
  criado_por uuid references auth.users(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.recepcao add column if not exists nome text;
alter table public.recepcao add column if not exists telefone text;
alter table public.recepcao add column if not exists motivo text;
alter table public.recepcao add column if not exists hora_chegada time;
alter table public.recepcao add column if not exists atendente text;
alter table public.recepcao add column if not exists bairro text;
alter table public.recepcao add column if not exists obs text;
alter table public.recepcao add column if not exists anexos jsonb not null default '[]'::jsonb;
alter table public.recepcao enable row level security;
drop policy if exists "equipe acessa recepcao" on public.recepcao;
create policy "equipe acessa recepcao" on public.recepcao for all to authenticated using (public.is_equipe()) with check (public.is_equipe());
drop trigger if exists recepcao_atualizado_em on public.recepcao;
create trigger recepcao_atualizado_em before update on public.recepcao for each row execute function public.tocar_atualizado_em();

-- Pessoas
create table if not exists public.pessoas (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'Ativo',
  nome text,
  tipo text,
  grupo text,
  telefone text,
  email text,
  nascimento date,
  cpf text,
  tratamento text,
  endereco text,
  bairro text,
  municipio text,
  uf text,
  cep text,
  indicado_por text,
  obs text,
  historico jsonb not null default '[]'::jsonb,
  anexos jsonb not null default '[]'::jsonb,
  criado_por uuid references auth.users(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.pessoas add column if not exists nome text;
alter table public.pessoas add column if not exists tipo text;
alter table public.pessoas add column if not exists grupo text;
alter table public.pessoas add column if not exists telefone text;
alter table public.pessoas add column if not exists email text;
alter table public.pessoas add column if not exists nascimento date;
alter table public.pessoas add column if not exists cpf text;
alter table public.pessoas add column if not exists tratamento text;
alter table public.pessoas add column if not exists endereco text;
alter table public.pessoas add column if not exists bairro text;
alter table public.pessoas add column if not exists municipio text;
alter table public.pessoas add column if not exists uf text;
alter table public.pessoas add column if not exists cep text;
alter table public.pessoas add column if not exists indicado_por text;
alter table public.pessoas add column if not exists obs text;
alter table public.pessoas add column if not exists anexos jsonb not null default '[]'::jsonb;
alter table public.pessoas enable row level security;
drop policy if exists "equipe acessa pessoas" on public.pessoas;
create policy "equipe acessa pessoas" on public.pessoas for all to authenticated using (public.is_equipe()) with check (public.is_equipe());
drop trigger if exists pessoas_atualizado_em on public.pessoas;
create trigger pessoas_atualizado_em before update on public.pessoas for each row execute function public.tocar_atualizado_em();

-- Atualização em tempo real entre os usuários
do $$ declare t text; begin
  foreach t in array array['demandas','servicos','emendas','proposituras','agenda','tarefas','recepcao','pessoas'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Anexos (fotos, PDFs, ofícios assinados): pasta privada, só a equipe acessa
insert into storage.buckets (id, name, public, file_size_limit)
values ('anexos', 'anexos', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;
drop policy if exists "equipe le anexos" on storage.objects;
create policy "equipe le anexos" on storage.objects for select to authenticated using (bucket_id = 'anexos' and public.is_equipe());
drop policy if exists "equipe envia anexos" on storage.objects;
create policy "equipe envia anexos" on storage.objects for insert to authenticated with check (bucket_id = 'anexos' and public.is_equipe());
drop policy if exists "equipe apaga anexos" on storage.objects;
create policy "equipe apaga anexos" on storage.objects for delete to authenticated using (bucket_id = 'anexos' and public.is_equipe());
-- o cidadão manda fotos pelo formulário do site: só pode CRIAR arquivos .jpg na pasta publico/<código>/ (não lê nem apaga nada)
drop policy if exists "cidadao envia fotos" on storage.objects;
create policy "cidadao envia fotos" on storage.objects for insert to anon, authenticated with check (bucket_id = 'anexos' and name ~ '^publico/[0-9a-f-]{36}/[0-9]+[.]jpg$');

-- Protocolo da demanda (ex.: 2026-000123): o cidadão usa para acompanhar o pedido.
alter table public.demandas add column if not exists protocolo text;
create sequence if not exists public.demandas_protocolo_seq;
create unique index if not exists demandas_protocolo_uk on public.demandas (protocolo);
-- demandas antigas recebem protocolo pela ordem de cadastro
with base as (select coalesce(max(substring(protocolo from '-([0-9]+)$')::int), 0) b from public.demandas),
     x as (select id, row_number() over (order by criado_em, id) n from public.demandas where protocolo is null)
update public.demandas d set protocolo = to_char(d.criado_em at time zone 'America/Sao_Paulo', 'YYYY') || '-' || lpad((base.b + x.n)::text, 6, '0')
  from x, base where d.id = x.id;
select setval('public.demandas_protocolo_seq', greatest(m, 1), m > 0)
  from (select coalesce(max(substring(protocolo from '-([0-9]+)$')::int), 0) m from public.demandas) t;
create or replace function public.demandas_protocolo() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.protocolo is not null then new.protocolo := old.protocolo; return new; end if;
  if new.protocolo is null or new.protocolo = '' then
    new.protocolo := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY') || '-' || lpad(nextval('public.demandas_protocolo_seq')::text, 6, '0');
  end if;
  return new;
end $$;
drop trigger if exists demandas_protocolo on public.demandas;
create trigger demandas_protocolo before insert or update on public.demandas for each row execute function public.demandas_protocolo();

-- Consulta pública: precisa do protocolo E do celular juntos. Mostra só a situação e as datas.
-- Trava contra adivinhação: 10 erros por protocolo por hora, 60 consultas por minuto no total.
create table if not exists public.consulta_tentativas (protocolo text not null, em timestamptz not null default now());
alter table public.consulta_tentativas enable row level security;
create or replace function public.consultar_protocolo(p_protocolo text, p_telefone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_prot text := upper(regexp_replace(coalesce(p_protocolo, ''), '[^0-9A-Za-z-]', '', 'g'));
  v_tel text := right(regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g'), 8);
  d public.demandas;
begin
  if v_prot = '' or length(v_tel) < 8 then raise exception 'Digite o número do protocolo e o celular com DDD.'; end if;
  if (select count(*) from public.consulta_tentativas where protocolo = v_prot and em > now() - interval '1 hour') >= 10
     or (select count(*) from public.consulta_tentativas where em > now() - interval '1 minute') >= 60 then
    raise exception 'Muitas tentativas. Tente de novo mais tarde.';
  end if;
  select * into d from public.demandas
    where protocolo = v_prot and length(regexp_replace(coalesce(telefone, ''), '[^0-9]', '', 'g')) >= 8
      and right(regexp_replace(coalesce(telefone, ''), '[^0-9]', '', 'g'), 8) = v_tel;
  if not found then
    insert into public.consulta_tentativas (protocolo) values (v_prot);
    delete from public.consulta_tentativas where em < now() - interval '1 day';
    return null;
  end if;
  return jsonb_build_object('protocolo', d.protocolo, 'assunto', d.assunto, 'status', d.status, 'bairro', d.bairro, 'municipio', d.municipio,
    'aberto_em', d.criado_em, 'atualizado_em', d.atualizado_em,
    'linha', coalesce((select jsonb_agg(jsonb_build_object('em', h->>'em',
        'txt', case when h->>'txt' like 'Situação:%' then 'Situação: ' || trim(split_part(h->>'txt', '→', 2))
                    when h->>'txt' like 'Cadastrado como%' or h->>'txt' like 'Recebida%' then 'Pedido registrado no gabinete'
                    else 'Ofício enviado ao órgão responsável' end) order by h->>'em')
      from jsonb_array_elements(coalesce(d.historico, '[]'::jsonb)) h
      where h->>'txt' like 'Situação:%' or h->>'txt' like 'Cadastrado como%' or h->>'txt' like 'Recebida pelo formulário%' or h->>'txt' like 'Ofício de solicitação criado%'), '[]'::jsonb),
    'gabinete', (select jsonb_build_object('gabinete', valor->>'gabinete', 'deputado_nome', valor->>'deputado_nome', 'deputado_cargo', valor->>'deputado_cargo') from public.config where id = 'gabinete'));
end $$;
revoke all on function public.consultar_protocolo(text, text) from public;
grant execute on function public.consultar_protocolo(text, text) to anon, authenticated;

-- Formulário público: o cidadão abre uma demanda sem login.
-- Só esta função é liberada para visitantes; eles não leem nada do banco.
drop function if exists public.nova_demanda_publica(text, text, text, text, text, text);
drop function if exists public.nova_demanda_publica(text, text, text, text, text, text, double precision, double precision);
drop function if exists public.nova_demanda_publica(text, text, text, text, text, text, double precision, double precision, jsonb);
drop function if exists public.nova_demanda_publica(text, text, text, text, text, text, double precision, double precision, jsonb, text, boolean);
-- p_categoria: Pedido, Emenda ou Denúncia. p_anonimo: denúncia sem nome e sem telefone.
create or replace function public.nova_demanda_publica(
  p_nome text, p_telefone text, p_municipio text, p_bairro text, p_assunto text, p_descricao text,
  p_lat double precision default null, p_lng double precision default null, p_fotos jsonb default null,
  p_categoria text default null, p_anonimo boolean default false
) returns text language plpgsql security definer set search_path = public as $$
declare v_anexos jsonb := '[]'::jsonb; v_prot text; v_cat text; v_anon boolean;
begin
  v_cat := case when p_categoria in ('Emenda', 'Denúncia') then p_categoria else 'Pedido' end;
  v_anon := v_cat = 'Denúncia' and coalesce(p_anonimo, false);
  if v_anon then
    p_nome := 'Anônimo';
    p_telefone := nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), '');
  end if;
  if coalesce(trim(p_nome), '') = '' or coalesce(trim(p_assunto), '') = '' or (not v_anon and coalesce(trim(p_telefone), '') = '') then
    raise exception 'Preencha nome, telefone e assunto.';
  end if;
  -- trava do celular: só aceita celular brasileiro com DDD (11 dígitos, o 3º é 9); grava no formato (45) 99999-9999
  if p_telefone is not null then
    p_telefone := regexp_replace(p_telefone, '\D', '', 'g');
    if length(p_telefone) > 11 and p_telefone like '55%' then p_telefone := substr(p_telefone, 3); end if;
    if p_telefone !~ '^[1-9][1-9]9[0-9]{8}$' then raise exception 'Digite um número de celular válido, com DDD.'; end if;
    p_telefone := '(' || substr(p_telefone, 1, 2) || ') ' || substr(p_telefone, 3, 5) || '-' || substr(p_telefone, 8);
  end if;
  -- trava contra abuso: no máximo 60 pedidos pelo site por hora, 3 por telefone por dia e 10 denúncias anônimas por hora
  if (select count(*) from public.demandas where origem = 'Site do gabinete' and criado_em > now() - interval '1 hour') >= 60 then
    raise exception 'Muitos pedidos agora. Tente de novo mais tarde.';
  end if;
  if p_telefone is not null and (select count(*) from public.demandas where origem = 'Site do gabinete' and telefone = left(trim(p_telefone), 30) and criado_em > now() - interval '1 day') >= 3 then
    raise exception 'Já recebemos seus pedidos de hoje. Em breve entraremos em contato.';
  end if;
  if p_telefone is null and (select count(*) from public.demandas where origem = 'Site do gabinete' and telefone is null and criado_em > now() - interval '1 hour') >= 10 then
    raise exception 'Muitas denúncias anônimas agora. Tente de novo mais tarde.';
  end if;
  if p_lat is not null and (p_lat not between -34 and 6 or p_lng not between -74 and -34) then p_lat := null; p_lng := null; end if;
  -- fotos já enviadas pelo cidadão (no máximo 5, só da pasta publico/)
  if p_fotos is not null and jsonb_typeof(p_fotos) = 'array' then
    select coalesce(jsonb_agg(jsonb_build_object('path', o.name, 'nome', 'Foto ' || x.n || ' do cidadão.jpg', 'tipo', 'image/jpeg',
      'tamanho', coalesce((o.metadata->>'size')::bigint, 0), 'em', now(), 'por', 'Cidadão') order by x.n), '[]'::jsonb)
    into v_anexos
    from (select value #>> '{}' as path, ordinality as n from jsonb_array_elements(p_fotos) with ordinality limit 5) x
    join storage.objects o on o.bucket_id = 'anexos' and o.name = x.path
    where x.path ~ '^publico/[0-9a-f-]{36}/[0-9]+[.]jpg$';
  end if;
  insert into public.demandas (status, categoria, assunto, solicitante, telefone, municipio, bairro, origem, descricao, prioridade, historico, criado_por, lat, lng, anexos)
  values ('Nova', v_cat, left(trim(p_assunto), 200), left(trim(p_nome), 120), left(trim(p_telefone), 30), nullif(left(trim(coalesce(p_municipio, '')), 80), ''),
    nullif(left(trim(coalesce(p_bairro, '')), 80), ''), 'Site do gabinete', nullif(left(trim(coalesce(p_descricao, '')), 3000), ''), case when v_cat = 'Denúncia' then 'Alta' else 'Média' end,
    jsonb_build_array(jsonb_build_object('em', now(), 'txt', 'Recebida pelo formulário do site'
      || case v_cat when 'Emenda' then ' (pedido de emenda)' when 'Denúncia' then ' (denúncia' || case when v_anon then ' anônima' else '' end || ')' else '' end || case when jsonb_array_length(v_anexos) > 0 then ' com ' || jsonb_array_length(v_anexos) || ' foto(s)' else '' end, 'por', 'Site')), null, p_lat, p_lng, v_anexos)
  returning protocolo into v_prot;
  return v_prot;
end $$;
revoke all on function public.nova_demanda_publica(text, text, text, text, text, text, double precision, double precision, jsonb, text, boolean) from public;
grant execute on function public.nova_demanda_publica(text, text, text, text, text, text, double precision, double precision, jsonb, text, boolean) to anon, authenticated;

-- Prestação de contas pública: só o que a equipe marcou como público e já foi resolvido.
-- Nunca devolve nome, telefone ou endereço do cidadão.
create or replace function public.prestacao_publica() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'gabinete', (select jsonb_build_object('gabinete', valor->>'gabinete', 'deputado_nome', valor->>'deputado_nome', 'deputado_cargo', valor->>'deputado_cargo', 'cidade', valor->>'cidade_gabinete') from public.config where id = 'gabinete'),
    'demandas', coalesce((select jsonb_agg(x order by x->>'data' desc) from (select jsonb_build_object('titulo', assunto, 'bairro', bairro, 'municipio', municipio, 'area', area, 'data', atualizado_em::date) x
      from public.demandas where publico and status = 'Concluída' order by atualizado_em desc limit 500) t), '[]'::jsonb),
    'servicos', coalesce((select jsonb_agg(x order by x->>'data' desc) from (select jsonb_build_object('titulo', servico, 'municipio', municipio, 'orgao', orgao, 'data', atualizado_em::date) x
      from public.servicos where publico and status = 'Atendida' order by atualizado_em desc limit 500) t), '[]'::jsonb),
    'emendas', coalesce((select jsonb_agg(x order by x->>'exercicio' desc) from (select jsonb_build_object('titulo', objeto, 'beneficiario', beneficiario, 'municipio', municipio, 'area', area, 'status', status, 'exercicio', exercicio,
      'valor', coalesce(nullif(valor_pago, 0), nullif(valor_empenhado, 0), valor_indicado)) x
      from public.emendas where publico and status in ('Indicada', 'Empenhada', 'Paga') order by exercicio desc nulls last limit 500) t), '[]'::jsonb)
  )
$$;
revoke all on function public.prestacao_publica() from public;
grant execute on function public.prestacao_publica() to anon, authenticated;

-- Pesquisa de satisfação: o cidadão avalia pelo link secreto que recebe no WhatsApp.
create or replace function public.avaliacao_info(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('assunto', d.assunto, 'nota', d.nota,
    'gabinete', (select jsonb_build_object('gabinete', valor->>'gabinete', 'deputado_nome', valor->>'deputado_nome', 'deputado_cargo', valor->>'deputado_cargo') from public.config where id = 'gabinete'))
  from public.demandas d where d.avaliacao_token = p_token
$$;
create or replace function public.avaliar_demanda(p_token uuid, p_nota integer, p_comentario text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_nota is null or p_nota < 1 or p_nota > 5 then raise exception 'Escolha uma nota de 1 a 5.'; end if;
  update public.demandas set nota = p_nota, nota_comentario = nullif(left(trim(coalesce(p_comentario, '')), 1000), ''), nota_em = now(),
    historico = historico || jsonb_build_array(jsonb_build_object('em', now(), 'txt', 'Avaliação do cidadão: ' || p_nota || ' de 5', 'por', 'Cidadão'))
  where avaliacao_token = p_token and nota is null;
  return found;
end $$;
revoke all on function public.avaliacao_info(uuid) from public;
revoke all on function public.avaliar_demanda(uuid, integer, text) from public;
grant execute on function public.avaliacao_info(uuid) to anon, authenticated;
grant execute on function public.avaliar_demanda(uuid, integer, text) to anon, authenticated;

-- Visitas ao site público: só contagem por dia e por página, sem guardar nada da pessoa.
create table if not exists public.visitas (
  dia date not null,
  pagina text not null,
  visitas integer not null default 0,
  visitantes integer not null default 0,
  primary key (dia, pagina)
);
alter table public.visitas enable row level security;
drop policy if exists "equipe ve visitas" on public.visitas;
create policy "equipe ve visitas" on public.visitas for select to authenticated using (public.is_equipe());
create or replace function public.registrar_visita(p_pagina text, p_novo boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_dia date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if p_pagina not in ('inicio', 'solicitar', 'consulta', 'prestacao', 'avaliar') then return; end if;
  insert into public.visitas as v (dia, pagina, visitas, visitantes) values (v_dia, p_pagina, 1, case when p_novo then 1 else 0 end)
  on conflict (dia, pagina) do update set visitas = v.visitas + 1, visitantes = v.visitantes + case when p_novo then 1 else 0 end;
end $$;
revoke all on function public.registrar_visita(text, boolean) from public;
grant execute on function public.registrar_visita(text, boolean) to anon, authenticated;
