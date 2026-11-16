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
    "anexos jsonb not null default '[]'::jsonb",
    'criado_por uuid references auth.users(id) default auth.uid()',
    'criado_em timestamptz not null default now()',
    'atualizado_em timestamptz not null default now()',
  ];
  p(`-- ${M.label}`);
  p(`create table if not exists public.${m} (\n  ${cols.join(',\n  ')}\n);`);
  // colunas novas em tabelas já existentes
  for (const f of M.fields) p(`alter table public.${m} add column if not exists ${f.k} ${SQL_TYPE[f.type] || 'text'};`);
  for (const [k, t] of (M.extraCols || [])) p(`alter table public.${m} add column if not exists ${k} ${t};`);
  p(`alter table public.${m} add column if not exists anexos jsonb not null default '[]'::jsonb;`);
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


p(`
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

-- Formulário público: o cidadão abre uma demanda sem login.
-- Só esta função é liberada para visitantes; eles não leem nada do banco.
drop function if exists public.nova_demanda_publica(text, text, text, text, text, text);
create or replace function public.nova_demanda_publica(
  p_nome text, p_telefone text, p_municipio text, p_bairro text, p_assunto text, p_descricao text,
  p_lat double precision default null, p_lng double precision default null
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(p_nome), '') = '' or coalesce(trim(p_assunto), '') = '' or coalesce(trim(p_telefone), '') = '' then
    raise exception 'Preencha nome, telefone e assunto.';
  end if;
  -- trava contra abuso: no máximo 60 pedidos pelo site por hora e 3 por telefone por dia
  if (select count(*) from public.demandas where origem = 'Site do gabinete' and criado_em > now() - interval '1 hour') >= 60 then
    raise exception 'Muitos pedidos agora. Tente de novo mais tarde.';
  end if;
  if (select count(*) from public.demandas where origem = 'Site do gabinete' and telefone = left(trim(p_telefone), 30) and criado_em > now() - interval '1 day') >= 3 then
    raise exception 'Já recebemos seus pedidos de hoje. Em breve entraremos em contato.';
  end if;
  if p_lat is not null and (p_lat not between -34 and 6 or p_lng not between -74 and -34) then p_lat := null; p_lng := null; end if;
  insert into public.demandas (status, assunto, solicitante, telefone, municipio, bairro, origem, descricao, prioridade, historico, criado_por, lat, lng)
  values ('Nova', left(trim(p_assunto), 200), left(trim(p_nome), 120), left(trim(p_telefone), 30), nullif(left(trim(coalesce(p_municipio, '')), 80), ''),
    nullif(left(trim(coalesce(p_bairro, '')), 80), ''), 'Site do gabinete', nullif(left(trim(coalesce(p_descricao, '')), 3000), ''), 'Média',
    jsonb_build_array(jsonb_build_object('em', now(), 'txt', 'Recebida pelo formulário do site', 'por', 'Site')), null, p_lat, p_lng);
  return true;
end $$;
revoke all on function public.nova_demanda_publica(text, text, text, text, text, text, double precision, double precision) from public;
grant execute on function public.nova_demanda_publica(text, text, text, text, text, text, double precision, double precision) to anon, authenticated;`);

p(`
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
grant execute on function public.prestacao_publica() to anon, authenticated;`);

p(`
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
grant execute on function public.avaliar_demanda(uuid, integer, text) to anon, authenticated;`);

console.log(out.join('\n'));
