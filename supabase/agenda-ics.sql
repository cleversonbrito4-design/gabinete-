-- Leitura de agendas externas (Gmail etc.) pelo banco, como reserva.
-- O Google às vezes bloqueia o servidor das funções com "erro 429" (muitos pedidos
-- vindos do mesmo endereço). O banco sai por outro endereço, então a função "agenda"
-- pede o arquivo .ics por aqui quando o caminho normal falha.
-- Só a função do servidor (service_role) pode usar.

create extension if not exists pg_net;

create or replace function public.ics_pedir(p_url text) returns bigint
language sql security definer set search_path = public, extensions as $$
  select net.http_get(p_url, headers := '{"User-Agent":"Mozilla/5.0 (FalaCascavel-Agenda)","Accept":"text/calendar, */*"}'::jsonb, timeout_milliseconds := 15000);
$$;

create or replace function public.ics_ler(p_id bigint) returns table(status int, erro text, conteudo text)
language sql security definer set search_path = public, extensions as $$
  select status_code, error_msg, content from net._http_response where id = p_id;
$$;

revoke all on function public.ics_pedir(text) from public, anon, authenticated;
revoke all on function public.ics_ler(bigint) from public, anon, authenticated;
grant execute on function public.ics_pedir(text) to service_role;
grant execute on function public.ics_ler(bigint) to service_role;
