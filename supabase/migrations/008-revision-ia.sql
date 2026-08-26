-- =====================================================================
--  Migración 008 — la revisión semántica deriva a la cola, no rechaza
--
--  El filtro de palabras sólo atrapa lo que alguien anotó en una lista.
--  Hay cosas que ninguna lista cubre: una acusación contra un funcionario
--  con nombre y apellido, el teléfono de un tercero, una amenaza sin una
--  sola grosería. Eso lo revisa un modelo antes del envío.
--
--  Pero el modelo se equivoca, y equivocarse acá tiene un costo concreto:
--  un vecino que escribió algo legítimo se va del stand creyendo que el
--  municipio lo censuró. Por eso su veredicto NO rechaza — manda la
--  propuesta a la misma cola de revisión que ya usa el filtro de palabras,
--  con el motivo escrito para quien la mire desde el panel.
--
--  Ejecutar en el SQL Editor de Supabase, después de la 007.
-- =====================================================================

do $guard$
begin
  if to_regclass('public.ideas') is null then
    raise exception
      'Falta el schema base. Ejecutá primero supabase/schema.sql en ESTE proyecto.';
  end if;
  if to_regproc('public.arbolia_sin_leet') is null then
    raise exception
      'Falta la migración 007. Ejecutá supabase/migrations/007-leet.sql primero.';
  end if;
end;
$guard$;

-- ---------------------------------------------------------------------
-- 1. POR QUÉ QUEDÓ EN REVISIÓN
--    Dato interno: lo ve el panel, nunca la pantalla ni el público. Al
--    haber revocado el SELECT general sobre anon en la 006 y otorgado
--    columnas una por una, esta columna nueva NO queda legible por el
--    público por omisión. Es el comportamiento que buscamos.
-- ---------------------------------------------------------------------
alter table public.ideas
  add column if not exists revision_motivo text;

comment on column public.ideas.revision_motivo is
  'Por qué la propuesta quedó para revisión. Interno: no se proyecta.';

-- ---------------------------------------------------------------------
-- 2. EL ENVÍO ACEPTA EL VEREDICTO DE LA REVISIÓN PREVIA
--
--    Se elimina la versión de 5 parámetros antes de crear la nueva.
--    "create or replace" con distinta cantidad de parámetros no reemplaza:
--    crea una sobrecarga, y PostgREST responde PGRST203 porque no puede
--    elegir entre las dos.
-- ---------------------------------------------------------------------
drop function if exists public.arbolia_submit_idea(text, text, text, text, text);

create or replace function public.arbolia_submit_idea(
  p_text        text,
  p_category    text,
  p_device_id   text,
  p_author_name text default null,
  p_age_range   text default null,
  p_revisar     boolean default false,
  p_motivo      text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare
  nueva  public.ideas;
  estado text := 'visible';
  motivo text := null;
begin
  if char_length(btrim(p_text)) not between 3 and 180 then
    raise exception 'TEXT_LENGTH';
  end if;

  if char_length(p_device_id) not between 8 and 64 then
    raise exception 'DEVICE_ID';
  end if;

  if not exists (select 1 from public.categories where slug = p_category) then
    p_category := 'comunidad';
  end if;

  -- Un rango desconocido se descarta en vez de rechazar la idea: perder la
  -- propuesta de un vecino por un dato de encuesta sería el peor canje.
  if p_age_range is not null
     and p_age_range not in ('menor18', '18-29', '30-44', '45-59', '60mas') then
    p_age_range := null;
  end if;

  p_author_name := nullif(btrim(coalesce(p_author_name, '')), '');
  if p_author_name is not null and char_length(p_author_name) > 40 then
    p_author_name := left(p_author_name, 40);
  end if;
  if p_author_name is not null and char_length(p_author_name) < 2 then
    p_author_name := null;
  end if;

  -- Si es menor de edad no se guarda el nombre, aunque lo haya escrito.
  -- Un nombre de menor en una base pública y proyectable no corresponde.
  if p_age_range = 'menor18' then
    p_author_name := null;
  end if;

  if p_revisar then
    estado := 'flagged';
    motivo := left(coalesce(nullif(btrim(p_motivo), ''), 'Revisión automática'), 300);
  end if;

  -- El estado entra como 'flagged' y el trigger de moderación sólo puede
  -- confirmarlo: nunca devuelve una propuesta a 'visible'.
  insert into public.ideas (text, category, device_id, author_name, age_range, status, revision_motivo)
  values (p_text, p_category, p_device_id, p_author_name, p_age_range, estado, motivo)
  returning * into nueva;

  return json_build_object(
    'id',         nueva.id,
    'text',       nueva.text,
    'category',   nueva.category,
    'status',     nueva.status,
    'created_at', nueva.created_at
  );
end;
$fn$;

grant execute on function public.arbolia_submit_idea(text, text, text, text, text, boolean, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. VERIFICACIÓN
-- ---------------------------------------------------------------------
do $check$
declare
  sobrecargas int;
  visible     boolean;
begin
  select count(*) into sobrecargas
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'arbolia_submit_idea';

  if sobrecargas <> 1 then
    raise exception
      'Hay % versiones de arbolia_submit_idea. PostgREST va a fallar con PGRST203.', sobrecargas;
  end if;

  -- El motivo es interno: el público no puede leerlo.
  select has_column_privilege('anon', 'public.ideas', 'revision_motivo', 'SELECT')
    into visible;
  if visible then
    raise exception
      'revision_motivo quedó legible por el público. Revisá los grants de la 006.';
  end if;

  raise notice 'OK: la revisión deriva a la cola y su motivo queda sólo para el panel.';
end;
$check$;
