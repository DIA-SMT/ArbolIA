-- =====================================================================
--  Migración 005 — quién propone: nombre opcional y rango etario
--
--  Suma dos datos a cada idea para poder leer la participación por edad
--  ("el rango de 30 a 44 pide sobre todo transporte") y para que quien
--  quiera pueda firmar su propuesta.
--
--  POR QUÉ RANGO Y NO EDAD EXACTA
--  ------------------------------
--  En un stand público van a participar menores. Guardar la edad precisa de
--  un menor es un dato personal sensible bajo la Ley 25.326; el rango da
--  exactamente la misma lectura estadística sin ese problema. Además, en un
--  celular y de pie, elegir un rango es un toque y escribir una edad es
--  abrir el teclado numérico.
--
--  El nombre es OPCIONAL a propósito: obligar a identificarse en un stand
--  municipal hace que no participe quien quiere proponer algo crítico.
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
-- 1. COLUMNAS
-- ---------------------------------------------------------------------
alter table public.ideas
  add column if not exists author_name text,
  add column if not exists age_range   text;

alter table public.ideas
  drop constraint if exists ideas_age_range_chk;

alter table public.ideas
  add constraint ideas_age_range_chk
  check (age_range is null or age_range in ('menor18', '18-29', '30-44', '45-59', '60mas'));

alter table public.ideas
  drop constraint if exists ideas_author_len;

alter table public.ideas
  add constraint ideas_author_len
  check (author_name is null or char_length(btrim(author_name)) between 2 and 40);

create index if not exists ideas_age_idx on public.ideas (age_range)
  where status = 'visible' and archived_at is null;

-- ---------------------------------------------------------------------
-- 2. EL FILTRO TAMBIÉN REVISA EL NOMBRE
--    Un nombre es texto libre igual que la propuesta: si alguien firma con
--    un insulto, quedaría proyectado en el LED.
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

  -- El nombre vacío se guarda como NULL, no como cadena vacía.
  new.author_name := nullif(btrim(coalesce(new.author_name, '')), '');

  -- Se revisa propuesta y nombre juntos.
  normalized := public.arbolia_normalize(new.text || ' ' || coalesce(new.author_name, ''));
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

  -- Palabra completa (ver migración 004).
  if exists (
    select 1 from public.blocked_words b
    where normalized ~ ('(^|[^a-z0-9])' || b.word || '([^a-z0-9]|$)')
  ) then
    new.status := 'flagged';

  -- Evasión deliberada: sólo si hay letras sueltas separadas por símbolos.
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
-- 3. ENVÍO CON AUTOR
-- ---------------------------------------------------------------------
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
-- 4. PARTICIPACIÓN POR EDAD
--    Devuelve, por rango, cuánta gente participó y qué áreas eligió. Es la
--    lectura que el municipio quiere: qué pide cada generación.
-- ---------------------------------------------------------------------
create or replace function public.arbolia_por_edad()
returns json
language sql
stable
security definer
set search_path = public
as $fn$
  with rangos as (
    select * from (values
      ('menor18', 'Menos de 18', 1),
      ('18-29',   '18 a 29',     2),
      ('30-44',   '30 a 44',     3),
      ('45-59',   '45 a 59',     4),
      ('60mas',   '60 o más',    5),
      ('sindato', 'Sin indicar', 6)
    ) as t(slug, label, orden)
  ),
  conteo as (
    select
      coalesce(age_range, 'sindato') as slug,
      count(*)::int                  as total,
      -- Área más elegida por ese rango.
      (array_agg(category order by category))[1] as muestra
    from public.ideas
    where status = 'visible' and archived_at is null
    group by 1
  ),
  top_area as (
    select distinct on (coalesce(i.age_range, 'sindato'))
      coalesce(i.age_range, 'sindato') as slug,
      i.category,
      count(*)::int as veces
    from public.ideas i
    where i.status = 'visible' and i.archived_at is null
    group by 1, 2
    order by 1, veces desc, i.category
  )
  select coalesce(
    json_agg(
      json_build_object(
        'slug',    r.slug,
        'label',   r.label,
        'total',   coalesce(c.total, 0),
        'topArea', t.category
      )
      order by r.orden
    ),
    '[]'::json
  )
  from rangos r
  left join conteo c  on c.slug = r.slug
  left join top_area t on t.slug = r.slug;
$fn$;

grant execute on function public.arbolia_por_edad() to anon, authenticated;
