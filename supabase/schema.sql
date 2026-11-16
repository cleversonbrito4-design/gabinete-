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
drop policy if exists "equipe gerencia equipe" on public.equipe;
create policy "equipe gerencia equipe" on public.equipe for all to authenticated using (public.is_equipe()) with check (public.is_equipe());

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
drop policy if exists "equipe acessa config" on public.config;
create policy "equipe acessa config" on public.config for all to authenticated using (public.is_equipe()) with check (public.is_equipe());

create or replace function public.tocar_atualizado_em() returns trigger language plpgsql as $$
begin new.atualizado_em = now(); return new; end $$;

-- Demandas
create table if not exists public.demandas (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'Nova',
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
  historico jsonb not null default '[]'::jsonb,
  criado_por uuid references auth.users(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
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
  historico jsonb not null default '[]'::jsonb,
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
  exercicio integer,
  quem_pediu text,
  numero text,
  obs text,
  historico jsonb not null default '[]'::jsonb,
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
alter table public.emendas add column if not exists exercicio integer;
alter table public.emendas add column if not exists quem_pediu text;
alter table public.emendas add column if not exists numero text;
alter table public.emendas add column if not exists obs text;
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
alter table public.agenda enable row level security;
drop policy if exists "equipe acessa agenda" on public.agenda;
create policy "equipe acessa agenda" on public.agenda for all to authenticated using (public.is_equipe()) with check (public.is_equipe());
drop trigger if exists agenda_atualizado_em on public.agenda;
create trigger agenda_atualizado_em before update on public.agenda for each row execute function public.tocar_atualizado_em();

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
alter table public.pessoas enable row level security;
drop policy if exists "equipe acessa pessoas" on public.pessoas;
create policy "equipe acessa pessoas" on public.pessoas for all to authenticated using (public.is_equipe()) with check (public.is_equipe());
drop trigger if exists pessoas_atualizado_em on public.pessoas;
create trigger pessoas_atualizado_em before update on public.pessoas for each row execute function public.tocar_atualizado_em();

-- Atualização em tempo real entre os usuários
do $$ declare t text; begin
  foreach t in array array['demandas','servicos','emendas','proposituras','agenda','pessoas'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
