-- =====================================================================
--  Migración 004 — el filtro compara palabras, no fragmentos
--
--  Problema que resuelve
--  ---------------------
--  El filtro buscaba subcadenas: `normalized like '%' || word || '%'`.
--  Sin límite de palabra, cualquier término legítimo que contuviera una
--  grosería adentro quedaba marcado:
--
--    "Más computadoras en las escuelas"        → contiene "puta"
--    "Que se pueda controlar los trámites"     → contiene "trola"
--    "Talleres de computación para mayores"    → contiene "puta"
--    "Una diputada propuso algo parecido"      → contiene "puta"
--    "Resolver la disputa por la plaza"        → contiene "puta"
--
--  Seis de cada nueve ideas normales caían en el filtro. Para el vecino eso
--  se veía como que el municipio lo acusaba de escribir un insulto por
--  proponer computadoras para una escuela.
--
--  La comparación compactada (la que atrapa "p-u-t-o") tenía el mismo
--  problema: "computadoras" compactado sigue conteniendo "puta". Ahora sólo
--  se aplica cuando el texto muestra el patrón de una evasión deliberada,
--  o sea letras sueltas separadas por símbolos.
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
  new.text   := btrim(new.text);
  normalized := public.arbolia_normalize(new.text);
  compact    := regexp_replace(normalized, '[^a-z0-9]', '', 'g');

  -- Rate limit: 1 idea cada 12 segundos por dispositivo.
  select max(created_at) into last_at
  from public.ideas
  where device_id = new.device_id;

  if last_at is not null and last_at > now() - interval '12 seconds' then
    raise exception 'RATE_LIMIT_COOLDOWN'
      using hint = 'Esperá unos segundos antes de enviar otra idea.';
  end if;

  -- Tope por dispositivo: 12 ideas por hora.
  select count(*) into recent_count
  from public.ideas
  where device_id = new.device_id
    and created_at > now() - interval '1 hour';

  if recent_count >= 12 then
    raise exception 'RATE_LIMIT_HOURLY'
      using hint = 'Ya enviaste muchas ideas. Dejale lugar a otros vecinos.';
  end if;

  -- ---- Filtro de contenido -------------------------------------------

  -- 1. Palabra completa. El patrón exige que a los lados haya algo que no
  --    sea letra ni número, o el borde del texto.
  if exists (
    select 1 from public.blocked_words b
    where normalized ~ ('(^|[^a-z0-9])' || b.word || '([^a-z0-9]|$)')
  ) then
    new.status := 'flagged';

  -- 2. Evasión deliberada: sólo si el texto tiene letras sueltas separadas
  --    por símbolos ("p-u-t-o", "p.u.t.o", "p u t o"). Aplicar esto a
  --    cualquier frase es lo que rechazaba "computadoras".
  elsif normalized ~ '(^|[^a-z0-9])([a-z][^a-z0-9]+){2,}[a-z]($|[^a-z0-9])' then
    if exists (
      select 1 from public.blocked_words b
      where compact like '%' || replace(b.word, ' ', '') || '%'
    ) then
      new.status := 'flagged';
    end if;
  end if;

  -- Texto sin ninguna letra (solo simbolos o numeros) tampoco entra al arbol.
  if normalized !~ '[a-z]' then
    new.status := 'flagged';
  end if;

  return new;
end;
$fn$;
