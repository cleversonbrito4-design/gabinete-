-- Avisos no celular antes dos compromissos (função "avisos").
-- Tabelas só para a função (RLS ligado e nenhuma regra: o site não lê nem grava).
create table if not exists public.segredos (
  id text primary key,
  valor jsonb not null,
  criado_em timestamptz not null default now()
);
create table if not exists public.avisos_aparelhos (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  email text,
  aparelho text,
  falhas int not null default 0,
  ultimo_envio timestamptz,
  criado_em timestamptz not null default now()
);
create table if not exists public.avisos_enviados (
  chave text primary key,
  em timestamptz not null default now()
);
alter table public.segredos enable row level security;
alter table public.avisos_aparelhos enable row level security;
alter table public.avisos_enviados enable row level security;
revoke all on public.segredos, public.avisos_aparelhos, public.avisos_enviados from anon, authenticated;

-- relógio: a cada 5 minutos chama a função para mandar os avisos que estão na hora
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('avisos-agenda') where exists (select 1 from cron.job where jobname = 'avisos-agenda');
select cron.schedule('avisos-agenda', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://ueqbdruyaxwrxjrmcvub.supabase.co/functions/v1/avisos',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-avisos', coalesce((select valor->>'cron' from public.segredos where id = 'avisos'), '-')),
    body := '{"acao":"rodar"}'::jsonb,
    timeout_milliseconds := 20000
  );
$$);
