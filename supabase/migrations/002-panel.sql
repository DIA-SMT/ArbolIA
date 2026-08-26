-- =====================================================================
--  Migración 002 — configuración editable y evolución en el tiempo
--
--  Agrega:
--    · una tabla de ajustes, para poder mover la meta durante la expo sin
--      redesplegar la aplicación;
--    · una función que devuelve las ideas recibidas hora por hora, para el
--      gráfico del panel.
--
--  Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. GUARDA
--    Si esto corre en un proyecto donde todavía no está el schema base, el
--    error nativo de Postgres aparece recién sesenta líneas más abajo y no
--    dice qué hacer. Mejor frenar acá con un mensaje claro.
-- ---------------------------------------------------------------------
do $guard$
begin
  if to_regclass('public.ideas') is null then
    raise exception
      'Falta el schema base. Ejecutá primero supabase/schema.sql (y 001-submit-idea.sql) en ESTE proyecto. Si la tabla ideas existe en otro lado, estás en el proyecto equivocado.';
  end if;
end;
$guard$;

-- ---------------------------------------------------------------------
-- 1. AJUSTES
--    Clave/valor. La lectura es pública porque la pantalla y el celular
--    necesitan saber la meta; la escritura, sólo del equipo autenticado.
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.settings (key, value) values
  ('goal', '500'::jsonb)
on conflict (key) do nothing;

alter table public.settings enable row level security;

drop policy if exists settings_public_read on public.settings;
create policy settings_public_read on public.settings
  for select using (true);

drop policy if exists settings_admin_write on public.settings;
create policy settings_admin_write on public.settings
  for all to authenticated using (true) with check (true);

-- Actualización con validación. Evita que un valor absurdo —una meta de
-- cero, o de un millón— deje la barra de progreso sin sentido en pantalla.
create or replace function public.arbolia_set_goal(p_goal int)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.role() is distinct from 'authenticated' then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_goal < 10 or p_goal > 100000 then
    raise exception 'GOAL_RANGE';
  end if;

  insert into public.settings (key, value, updated_at)
  values ('goal', to_jsonb(p_goal), now())
  on conflict (key) do update
    set value = excluded.value, updated_at = now();

  return p_goal;
end;
$fn$;

-- ---------------------------------------------------------------------
-- 2. EVOLUCIÓN EN EL TIEMPO
--
--    Devuelve una fila por hora, incluidas las horas sin ideas: un gráfico
--    que se saltea las horas vacías miente sobre el ritmo de participación
--    y hace parecer continuo lo que fue a los tirones.
--
--    Las horas se calculan en hora de Tucumán, no en UTC. Con UTC el pico
--    de las 18 aparecería a las 21 y la lectura del gráfico sería inútil
--    para decidir cuándo reforzar el stand.
-- ---------------------------------------------------------------------
create or replace function public.arbolia_timeline(p_hours int default 24)
returns json
language sql
stable
security definer
set search_path = public
as $fn$
  with rango as (
    select generate_series(
      date_trunc('hour', (now() at time zone 'America/Argentina/Tucuman'))
        - make_interval(hours => greatest(1, least(p_hours, 336)) - 1),
      date_trunc('hour', (now() at time zone 'America/Argentina/Tucuman')),
      interval '1 hour'
    ) as hora
  ),
  conteo as (
    select
      date_trunc('hour', (created_at at time zone 'America/Argentina/Tucuman')) as hora,
      count(*) filter (where status = 'visible')::int as publicadas,
      count(*) filter (where status = 'flagged')::int as marcadas,
      count(distinct device_id)::int                  as dispositivos
    from public.ideas
    where archived_at is null
    group by 1
  )
  select coalesce(
    json_agg(
      json_build_object(
        'hora',         to_char(r.hora, 'YYYY-MM-DD"T"HH24:00:00'),
        'publicadas',   coalesce(c.publicadas, 0),
        'marcadas',     coalesce(c.marcadas, 0),
        'dispositivos', coalesce(c.dispositivos, 0)
      )
      order by r.hora
    ),
    '[]'::json
  )
  from rango r
  left join conteo c on c.hora = r.hora;
$fn$;

-- ---------------------------------------------------------------------
-- 3. PERMISOS
-- ---------------------------------------------------------------------
grant execute on function public.arbolia_set_goal(int)  to authenticated;
grant execute on function public.arbolia_timeline(int)  to anon, authenticated;
