-- =====================================================================
--  Migración 007 — el filtro entiende sustituciones "leet"
--
--  Un vecino escribió en el stand:
--
--    "Estoy harto de esta gestion de m1erd4, no hace nada"
--
--  y se publicó entero. El filtro compara palabras y ahí no hay ninguna de
--  la lista: 1 por i y 4 por a alcanzan para evadir cualquier lista de
--  términos, y es lo primero que prueba quien quiere colar algo.
--
--  Se agrega una comparación ADICIONAL sobre el texto con los dígitos
--  revertidos a letras. Adicional y no en reemplazo: convertir dígitos a
--  letras en todo texto podría deformar propuestas legítimas que hablan de
--  la ruta 9, del colectivo 118 o de plantar 100 árboles.
--
--  Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

do $guard$
begin
  if to_regclass('public.ideas') is null then
    raise exception
      'Falta el schema base. Ejecutá primero supabase/schema.sql en ESTE proyecto.';
  end if;
end;
$guard$;

-- ---------------------------------------------------------------------
-- 1. REVERSIÓN DE LEET
--    0→o  1→i  3→e  4→a  5→s  7→t  @→a  $→s  !→i
-- ---------------------------------------------------------------------
create or replace function public.arbolia_sin_leet(txt text)
returns text
language sql
immutable
as $fn$
  select translate(txt, '013457@$!', 'oieastasi');
$fn$;

-- ---------------------------------------------------------------------
-- 2. EL TRIGGER SUMA ESA COMPARACIÓN
-- ---------------------------------------------------------------------
create or replace function public.arbolia_moderate_idea()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  normalized   text;
  sin_leet     text;
  compact      text;
  recent_count int;
  last_at      timestamptz;
begin
  new.text := btrim(new.text);
  new.author_name := nullif(btrim(coalesce(new.author_name, '')), '');

  -- Propuesta y nombre se revisan juntos: una firma con un insulto quedaría
  -- proyectada igual que la propuesta.
  normalized := public.arbolia_normalize(new.text || ' ' || coalesce(new.author_name, ''));
  sin_leet   := public.arbolia_sin_leet(normalized);
  compact    := regexp_replace(normalized, '[^a-z0-9]', '', 'g');

  -- Rate limit: 1 idea cada 12 segundos por dispositivo.
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

  -- ---- Filtro de contenido -------------------------------------------

  -- 1. Palabra completa sobre el texto tal cual.
  if exists (
    select 1 from public.blocked_words b
    where normalized ~ ('(^|[^a-z0-9])' || b.word || '([^a-z0-9]|$)')
  ) then
    new.status := 'flagged';

  -- 2. Palabra completa sobre el texto con los dígitos revertidos.
  elsif exists (
    select 1 from public.blocked_words b
    where sin_leet ~ ('(^|[^a-z0-9])' || b.word || '([^a-z0-9]|$)')
  ) then
    new.status := 'flagged';

  -- 3. Letras sueltas separadas por símbolos ("p-u-t-o").
  elsif normalized ~ '(^|[^a-z0-9])([a-z][^a-z0-9]+){2,}[a-z]($|[^a-z0-9])' then
    if exists (
      select 1 from public.blocked_words b
      where regexp_replace(sin_leet, '[^a-z0-9]', '', 'g')
            like '%' || replace(b.word, ' ', '') || '%'
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
-- 3. VERIFICACIÓN
-- ---------------------------------------------------------------------
do $check$
declare
  caso   text;
  ofensivos text[] := array[
    'Estoy harto de esta gestion de m1erd4, no hace nada',
    'que pel0tud0 el intendente',
    'son unos l4dr0nes'
  ];
  legitimos text[] := array[
    'Plantar 100 arboles nativos en la avenida',
    'Mejorar la parada del 118 en la terminal',
    'Un carril exclusivo en la ruta 9'
  ];
  marca boolean;
begin
  foreach caso in array ofensivos loop
    select exists (
      select 1 from public.blocked_words b
      where public.arbolia_sin_leet(public.arbolia_normalize(caso))
            ~ ('(^|[^a-z0-9])' || b.word || '([^a-z0-9]|$)')
    ) into marca;
    if not marca then
      raise exception 'El filtro sigue dejando pasar: %', caso;
    end if;
  end loop;

  foreach caso in array legitimos loop
    select exists (
      select 1 from public.blocked_words b
      where public.arbolia_sin_leet(public.arbolia_normalize(caso))
            ~ ('(^|[^a-z0-9])' || b.word || '([^a-z0-9]|$)')
    ) into marca;
    if marca then
      raise exception 'El filtro rechaza una idea legítima: %', caso;
    end if;
  end loop;

  raise notice 'OK: el filtro atrapa las evasiones leet y no toca las ideas con números.';
end;
$check$;
