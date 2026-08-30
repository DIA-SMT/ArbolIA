-- =====================================================================
--  Migración 010 — el panel es de un equipo, no de cualquiera con cuenta
--
--  Hasta acá todas las políticas del panel decían:
--
--      for select to authenticated using (true)
--
--  "authenticated" es cualquiera que tenga una sesión. Con el registro
--  abierto en Supabase, eso significa que cualquier persona que se cree
--  una cuenta —no que adivine una contraseña: que se registre— podía leer
--  el nombre, la edad y el dispositivo de cada vecino que participó,
--  moderar la pantalla del stand, cambiar la meta y archivar todo.
--
--  Los grants por columna de la 006 no protegen de eso: protegen al rol
--  anónimo, y un registrado deja de serlo.
--
--  Ahora el acceso depende de estar en una lista, no de tener sesión. Si
--  alguien se registra, entra a un panel vacío: sin ideas, sin datos, sin
--  poder tocar nada. Y deja de depender de que alguien se haya acordado
--  de apagar el registro en un tablero.
--
--  Ejecutar en el SQL Editor de Supabase, después de la 009.
-- =====================================================================

do $guard$
begin
  if to_regclass('public.ideas') is null then
    raise exception 'Falta el schema base. Ejecutá primero supabase/schema.sql.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ideas' and column_name = 'tipo'
  ) then
    raise exception 'Falta la migración 009. Ejecutá supabase/migrations/009-criticas.sql primero.';
  end if;
end;
$guard$;

-- ---------------------------------------------------------------------
-- 1. QUIÉNES SON EL EQUIPO
-- ---------------------------------------------------------------------
create table if not exists public.equipo (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  nota       text,
  agregado_at timestamptz not null default now()
);

comment on table public.equipo is
  'Cuentas autorizadas a usar el panel. Tener sesión no alcanza: hay que estar acá.';

alter table public.equipo enable row level security;

-- Nadie la lee desde el cliente. Se consulta sólo a través de la función
-- de abajo, que corre con permisos elevados: la lista de quién tiene
-- acceso no es información que deba poder enumerarse.
drop policy if exists equipo_sin_acceso on public.equipo;
create policy equipo_sin_acceso on public.equipo for select using (false);

revoke all on public.equipo from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. LA COMPROBACIÓN
--
--    SECURITY DEFINER para que pueda leer la tabla pese a su RLS, y
--    STABLE para que Postgres la evalúe una vez por consulta y no una vez
--    por fila: va dentro de políticas que se aplican a cada fila leída.
-- ---------------------------------------------------------------------
create or replace function public.es_del_equipo()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (select 1 from public.equipo where user_id = auth.uid());
$fn$;

grant execute on function public.es_del_equipo() to authenticated, anon;

-- ---------------------------------------------------------------------
-- 3. LAS POLÍTICAS DEJAN DE CONFIAR EN "TENER SESIÓN"
-- ---------------------------------------------------------------------
drop policy if exists ideas_admin_read on public.ideas;
create policy ideas_admin_read on public.ideas
  for select to authenticated using (public.es_del_equipo());

drop policy if exists ideas_admin_update on public.ideas;
create policy ideas_admin_update on public.ideas
  for update to authenticated
  using (public.es_del_equipo())
  with check (public.es_del_equipo());

drop policy if exists blocked_admin on public.blocked_words;
create policy blocked_admin on public.blocked_words
  for all to authenticated
  using (public.es_del_equipo())
  with check (public.es_del_equipo());

drop policy if exists settings_admin_write on public.settings;
create policy settings_admin_write on public.settings
  for all to authenticated
  using (public.es_del_equipo())
  with check (public.es_del_equipo());

-- ---------------------------------------------------------------------
-- 4. LAS FUNCIONES DEL PANEL, IGUAL
--
--    Son SECURITY DEFINER: corren con permisos elevados y las políticas
--    de arriba no las alcanzan. Su control tiene que ser explícito.
-- ---------------------------------------------------------------------
create or replace function public.arbolia_reset_stats()
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  affected int;
begin
  if not public.es_del_equipo() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  update public.ideas
     set archived_at = now()
   where archived_at is null;

  get diagnostics affected = row_count;

  insert into public.moderation_events (idea_id, action)
  values ('00000000-0000-0000-0000-000000000000', 'archived_all');

  return affected;
end;
$fn$;

grant execute on function public.arbolia_reset_stats() to authenticated;

do $meta$
begin
  if to_regproc('public.arbolia_set_goal') is not null then
    execute $sql$
      create or replace function public.arbolia_set_goal(p_goal int)
      returns int
      language plpgsql
      security definer
      set search_path = public
      as $fn$
      begin
        if not public.es_del_equipo() then
          raise exception 'NOT_AUTHORIZED';
        end if;

        if p_goal is null or p_goal < 1 or p_goal > 1000000 then
          raise exception 'GOAL_RANGE';
        end if;

        insert into public.settings (key, value)
        values ('goal', p_goal::text)
        on conflict (key) do update set value = excluded.value;

        return p_goal;
      end;
      $fn$;
    $sql$;
    execute 'grant execute on function public.arbolia_set_goal(int) to authenticated';
  end if;
end;
$meta$;

-- ---------------------------------------------------------------------
-- 5. QUIÉN QUEDA ADENTRO
--
--    Sólo la cuenta del equipo de la Dirección de IA. Para sumar a
--    alguien más, que primero cree su cuenta y después:
--
--      insert into public.equipo (user_id, email)
--      select id, email from auth.users where email = 'persona@smt.gob.ar';
--
--    Para sacar a alguien:
--
--      delete from public.equipo where email = 'persona@smt.gob.ar';
-- ---------------------------------------------------------------------
insert into public.equipo (user_id, email, nota)
select id, email, 'Dirección de IA — alta inicial'
from auth.users
where lower(email) = 'direccionia@smt.gob.ar'
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------
-- 6. VERIFICACIÓN
-- ---------------------------------------------------------------------
do $check$
declare
  r            record;
  en_equipo    int;
  registradas  int;
  sin_permiso  int := 0;
begin
  select count(*) into en_equipo from public.equipo;
  select count(*) into registradas from auth.users;

  if en_equipo = 0 then
    raise exception
      'El equipo quedó vacío: nadie podría entrar al panel. ¿Existe la cuenta direccionia@smt.gob.ar? Revisá el paso 5.';
  end if;

  -- Ninguna política del panel puede seguir confiando sólo en la sesión.
  for r in
    select tablename, policyname, qual::text as expresion
    from pg_policies
    where schemaname = 'public'
      and policyname in ('ideas_admin_read', 'ideas_admin_update', 'blocked_admin', 'settings_admin_write')
  loop
    if r.expresion is null or r.expresion !~ 'es_del_equipo' then
      sin_permiso := sin_permiso + 1;
      raise notice 'La política % de % no comprueba el equipo: %', r.policyname, r.tablename, r.expresion;
    end if;
  end loop;

  if sin_permiso > 0 then
    raise exception
      'Quedaron % políticas del panel abiertas a cualquier cuenta registrada.', sin_permiso;
  end if;

  raise notice
    'OK: % cuenta(s) en el equipo sobre % registrada(s) en el proyecto. Las políticas del panel ya no alcanzan con tener sesión.',
    en_equipo, registradas;

  -- Si hay cuentas registradas que no son del equipo, conviene mirarlas.
  for r in
    select u.email, u.created_at
    from auth.users u
    left join public.equipo e on e.user_id = u.id
    where e.user_id is null
  loop
    raise notice 'Cuenta registrada SIN acceso al panel: % (creada %)', r.email, r.created_at;
  end loop;
end;
$check$;
