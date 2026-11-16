// Gera supabase/schema.sql a partir de src/schema.js.  Uso: npm run sql
import { MODS, ORDER, SQL_TYPE } from '../src/schema.js';

const out = [];
const p = s => out.push(s);
p('-- Gerado por scripts/gen-sql.mjs. Cole no SQL Editor do Supabase e clique em Run.');
p('-- Pode rodar de novo com segurança: só cria o que ainda não existe.\n');

p(`-- Equipe: só e-mails desta lista acessam os dados (mesmo que alguém crie conta)
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
`);

p(`create table if not exists public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  criado_em timestamptz not null default now()
);
alter table public.perfis enable row level security;
drop policy if exists "equipe le perfis" on public.perfis;
create policy "equipe le perfis" on public.perfis for select to authenticated using (public.is_equipe());
drop policy if exists "cada um grava o seu perfil" on public.perfis;
create policy "cada um grava o seu perfil" on public.perfis for all to authenticated using (id = auth.uid() and public.is_equipe()) with check (id = auth.uid() and public.is_equipe());
`);

p(`create table if not exists public.config (
  id text primary key,
  valor jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);
alter table public.config enable row level security;
drop policy if exists "equipe acessa config" on public.config;
create policy "equipe acessa config" on public.config for all to authenticated using (public.is_equipe()) with check (public.is_equipe());
`);

p(`create or replace function public.tocar_atualizado_em() returns trigger language plpgsql as $$
begin new.atualizado_em = now(); return new; end $$;
`);

for (const m of ORDER) {
  const M = MODS[m];
  const cols = [
    'id uuid primary key default gen_random_uuid()',
    `status text not null default '${M.statuses[0][0]}'`,
    ...M.fields.map(f => `${f.k} ${SQL_TYPE[f.type] || 'text'}`),
    ...(M.extraCols || []).map(([k, t]) => `${k} ${t}`),
    "historico jsonb not null default '[]'::jsonb",
    'criado_por uuid references auth.users(id) default auth.uid()',
    'criado_em timestamptz not null default now()',
    'atualizado_em timestamptz not null default now()',
  ];
  p(`-- ${M.label}`);
  p(`create table if not exists public.${m} (\n  ${cols.join(',\n  ')}\n);`);
  // colunas novas em tabelas já existentes
  for (const f of M.fields) p(`alter table public.${m} add column if not exists ${f.k} ${SQL_TYPE[f.type] || 'text'};`);
  for (const [k, t] of (M.extraCols || [])) p(`alter table public.${m} add column if not exists ${k} ${t};`);
  p(`alter table public.${m} enable row level security;
drop policy if exists "equipe acessa ${m}" on public.${m};
create policy "equipe acessa ${m}" on public.${m} for all to authenticated using (public.is_equipe()) with check (public.is_equipe());
drop trigger if exists ${m}_atualizado_em on public.${m};
create trigger ${m}_atualizado_em before update on public.${m} for each row execute function public.tocar_atualizado_em();
`);
}

p(`-- Atualização em tempo real entre os usuários
do $$ declare t text; begin
  foreach t in array array[${ORDER.map(m => `'${m}'`).join(',')}] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;`);

console.log(out.join('\n'));
