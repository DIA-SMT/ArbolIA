-- =====================================================================
--  REVERSIÓN de las migraciones 007 y 008
--
--  Para usar sólo si algo sale mal durante ExpoCom y hay que volver al
--  estado anterior rápido.
--
--  NO revertir volviendo a pegar 005-autor.sql. Es lo que uno hace por
--  instinto y deja la base peor:
--
--    · La 005 crea arbolia_submit_idea con CINCO parámetros sin borrar la
--      de siete. Quedan dos sobrecargas y PostgREST responde PGRST203
--      "Could not choose the best candidate function" a todos los envíos.
--      Ya nos pasó una vez.
--    · La 005 reemplaza el trigger con el cuerpo anterior sin decir nada:
--      el filtro leet desaparece y nadie se entera hasta que alguien cuela
--      un "m1erd4" en la pantalla.
--
--  Este archivo es autocontenido: se pega entero y listo. No hay pasos
--  manuales que olvidarse, porque el SQL Editor corre todo en una sola
--  transacción y un paso salteado revertiría el resto igual.
--
--  QUÉ NO DESHACE, a propósito:
--    · La columna ideas.revision_motivo se queda. Es nullable, el público
--      no puede leerla (grants por columna de la 006) y borrarla tiraría
--      el registro de por qué se moderó cada propuesta, que es justo lo
--      que sirve para el informe posterior.
-- =====================================================================

do $guard$
begin
  if to_regclass('public.ideas') is null then
    raise exception 'Este no es el proyecto de Arbolia: no existe public.ideas.';
  end if;
end;
$guard$;

-- ---------------------------------------------------------------------
-- 1. EL TRIGGER VUELVE AL COMPORTAMIENTO DE LA 005
--    Sin reversión de leet. La tercera regla queda como estaba, con el
--    falso positivo de las siglas incluido: es el estado anterior, no uno
--    mejor.
-- ---------------------------------------------------------------------
create or replace function public.arbolia_moderate_idea()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  normalized   text;
  compact      text;
  recent_count int;
  last_at      timestamptz;
begin
  new.text := btrim(new.text);
  new.author_name := nullif(btrim(coalesce(new.author_name, '')), '');

  normalized := public.arbolia_normalize(new.text || ' ' || coalesce(new.author_name, ''));
  compact    := regexp_replace(normalized, '[^a-z0-9]', '', 'g');

  select max(created_at) into last_at
  from public.ideas
  where device_id = new.device_id;

  if last_at is not null and last_at > now() - interval '12 seconds' then
    raise exception 'RATE_LIMIT_COOLDOWN'
      using hint = 'Esperá unos segundos antes de enviar otra idea.';
  end if;

  select count(*) into recent_count
  from public.ideas
  where device_id = new.device_id
    and created_at > now() - interval '1 hour';

  if recent_count >= 12 then
    raise exception 'RATE_LIMIT_HOURLY'
      using hint = 'Ya enviaste muchas ideas. Dejale lugar a otros vecinos.';
  end if;

  if exists (
    select 1 from public.blocked_words b
    where normalized ~ ('(^|[^a-z0-9])' || b.word || '([^a-z0-9]|$)')
  ) then
    new.status := 'flagged';
  elsif normalized ~ '(^|[^a-z0-9])([a-z][^a-z0-9]+){2,}[a-z]($|[^a-z0-9])' then
    if exists (
      select 1 from public.blocked_words b
      where compact like '%' || replace(b.word, ' ', '') || '%'
    ) then
      new.status := 'flagged';
    end if;
  end if;

  if public.arbolia_normalize(new.text) !~ '[a-z]' then
    new.status := 'flagged';
  end if;

  return new;
end;
$fn$;

-- ---------------------------------------------------------------------
-- 2. EL RPC VUELVE A CINCO PARÁMETROS
--    Con el drop explícito de la versión de siete: si se creara la de
--    cinco sin borrar la otra, quedarían las dos y PostgREST no podría
--    elegir.
-- ---------------------------------------------------------------------
drop function if exists public.arbolia_submit_idea(text, text, text, text, text, boolean, text);

create or replace function public.arbolia_submit_idea(
  p_text        text,
  p_category    text,
  p_device_id   text,
  p_author_name text default null,
  p_age_range   text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare
  nueva public.ideas;
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

  if p_age_range = 'menor18' then
    p_author_name := null;
  end if;

  insert into public.ideas (text, category, device_id, author_name, age_range)
  values (p_text, p_category, p_device_id, p_author_name, p_age_range)
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

grant execute on function public.arbolia_submit_idea(text, text, text, text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. LA FUNCIÓN DE LEET YA NO LA USA NADIE
--    Se borra para que el guard de la 008 detecte correctamente que hay
--    que volver a correr la 007 antes que ella.
-- ---------------------------------------------------------------------
drop function if exists public.arbolia_sin_leet(text);

-- ---------------------------------------------------------------------
-- 4. VERIFICACIÓN
-- ---------------------------------------------------------------------
do $check$
declare
  sobrecargas int;
  obtenido    text;
begin
  select count(*) into sobrecargas
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'arbolia_submit_idea';

  if sobrecargas <> 1 then
    raise exception
      'La reversión NO se aplicó. Quedaron % versiones de arbolia_submit_idea; PostgREST va a fallar con PGRST203.',
      sobrecargas;
  end if;

  -- El trigger tiene que seguir frenando lo obvio.
  insert into public.ideas (text, category, device_id)
  values ('esta ciudad es una mierda', 'comunidad', 'rollback-chk-1')
  returning status into obtenido;

  if obtenido <> 'flagged' then
    raise exception
      'La reversión NO se aplicó: el trigger dejó pasar un insulto directo.';
  end if;

  insert into public.ideas (text, category, device_id)
  values ('Mas luces en la plaza del barrio', 'comunidad', 'rollback-chk-2')
  returning status into obtenido;

  if obtenido <> 'visible' then
    raise exception
      'La reversión NO se aplicó: el trigger está marcando una idea legítima.';
  end if;

  delete from public.ideas where device_id like 'rollback-chk-%';

  raise notice
    'OK: base revertida al estado previo a la 007. Acordate de volver a desplegar el frontend anterior, o de dejarlo como está: submitIdea reintenta sin los parámetros nuevos cuando la función es la de cinco.';
end;
$check$;
