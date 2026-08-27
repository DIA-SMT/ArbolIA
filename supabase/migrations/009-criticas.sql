-- =====================================================================
--  Migración 009 — la crítica alimenta las raíces
--
--  Hasta ahora toda propuesta hacía lo mismo: viajaba desde las raíces,
--  subía por el tronco y brotaba como una hoja en su rama.
--
--  A partir de acá se distinguen dos gestos, porque no son el mismo:
--
--    · PROPUESTA — pide algo concreto ("más colectivos por Mate de Luna").
--      Sigue igual: sube y brota como hoja en la copa.
--
--    · CRÍTICA — señala algo que está mal ("el municipio no limpia el
--      barrio hace meses"). No deja hoja: cae desde la copa, se hunde en
--      la tierra y extiende las raíces, que en esta instalación son la
--      comunidad.
--
--  Las dos se guardan igual, cuentan para la meta y entran en el informe
--  posterior. Lo único que cambia es dónde aparecen en el árbol. Un
--  municipio que proyecta el reclamo del vecino como alimento del árbol
--  dice algo que ningún cartel diría.
--
--  Ejecutar en el SQL Editor de Supabase, después de la 008.
-- =====================================================================

do $guard$
begin
  if to_regclass('public.ideas') is null then
    raise exception
      'Falta el schema base. Ejecutá primero supabase/schema.sql en ESTE proyecto.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ideas' and column_name = 'revision_motivo'
  ) then
    raise exception
      'Falta la migración 008. Ejecutá supabase/migrations/008-revision-ia.sql primero.';
  end if;
end;
$guard$;

-- ---------------------------------------------------------------------
-- 1. LA COLUMNA
--
--    Por defecto 'propuesta'. Todo lo que ya está cargado queda como
--    estaba —brotando en la copa— y nada se mueve de lugar.
-- ---------------------------------------------------------------------
alter table public.ideas
  add column if not exists tipo text not null default 'propuesta';

do $c$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ideas_tipo_chk'
  ) then
    alter table public.ideas
      add constraint ideas_tipo_chk check (tipo in ('propuesta', 'critica'));
  end if;
end;
$c$;

create index if not exists ideas_tipo_idx on public.ideas (tipo);

comment on column public.ideas.tipo is
  'propuesta = brota como hoja en su rama. critica = cae y extiende las raíces.';

-- ---------------------------------------------------------------------
-- 2. ESTA COLUMNA SÍ ES PÚBLICA
--
--    Es la excepción al criterio de la 006. Ahí se revocó el SELECT
--    general de anon y se otorgaron columnas una por una, de modo que
--    author_name, age_range, device_id y revision_motivo quedaran
--    adentro: son datos que enriquecen la base para el informe, no cosas
--    para proyectar.
--
--    'tipo' es distinto. La pantalla NECESITA leerlo para saber si la
--    idea brota como hoja o cae a las raíces. Sin este grant la pantalla
--    no puede decidir y todo vuelve a verse igual.
--
--    Sigue sin revelar nada de la persona: dice qué es el texto, no quién
--    lo escribió.
-- ---------------------------------------------------------------------
grant select (tipo) on public.ideas to anon;

-- ---------------------------------------------------------------------
-- 3. EL ENVÍO ACEPTA EL TIPO
--
--    Se elimina la versión de 7 parámetros antes de crear la de 8.
--    "create or replace" con distinta cantidad de parámetros no reemplaza:
--    crea una sobrecarga, y PostgREST responde PGRST203 porque no puede
--    elegir entre las dos. Ya pasó dos veces.
-- ---------------------------------------------------------------------
drop function if exists
  public.arbolia_submit_idea(text, text, text, text, text, boolean, text);

create or replace function public.arbolia_submit_idea(
  p_text        text,
  p_category    text,
  p_device_id   text,
  p_author_name text default null,
  p_age_range   text default null,
  p_revisar     boolean default false,
  p_motivo      text default null,
  p_tipo        text default 'propuesta'
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

  -- Un tipo desconocido cae a 'propuesta'. Es el degradado seguro: la idea
  -- brota como hoja, que es lo que pasaba antes de que esto existiera. Si
  -- el degradado fuera 'critica', un problema en la clasificación dejaría
  -- la copa vacía y las raíces creciendo solas.
  if p_tipo is null or p_tipo not in ('propuesta', 'critica') then
    p_tipo := 'propuesta';
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
  if p_age_range = 'menor18' then
    p_author_name := null;
  end if;

  if p_revisar then
    estado := 'flagged';
    motivo := left(coalesce(nullif(btrim(p_motivo), ''), 'Revisión automática'), 300);
  end if;

  insert into public.ideas
    (text, category, device_id, author_name, age_range, status, revision_motivo, tipo)
  values
    (p_text, p_category, p_device_id, p_author_name, p_age_range, estado, motivo, p_tipo)
  returning * into nueva;

  return json_build_object(
    'id',         nueva.id,
    'text',       nueva.text,
    'category',   nueva.category,
    'status',     nueva.status,
    'tipo',       nueva.tipo,
    'created_at', nueva.created_at
  );
end;
$fn$;

grant execute on function
  public.arbolia_submit_idea(text, text, text, text, text, boolean, text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. LAS ESTADÍSTICAS SEPARAN LOS DOS GESTOS
--
--    'ideas' sigue siendo el total: la crítica participa como cualquier
--    otra y cuenta para la meta. Se agregan los dos desagregados porque
--    la pantalla necesita saber cuántas críticas hay para decidir cuánto
--    se extienden las raíces, y el informe posterior va a querer saber
--    qué proporción del stand fue reclamo.
-- ---------------------------------------------------------------------
create or replace function public.arbolia_stats()
returns json
language sql
stable
security definer
set search_path = public
as $fn$
  select json_build_object(
    'ideas',        (select count(*) from public.ideas
                      where status = 'visible' and archived_at is null),
    'propuestas',   (select count(*) from public.ideas
                      where status = 'visible' and archived_at is null
                        and tipo = 'propuesta'),
    'criticas',     (select count(*) from public.ideas
                      where status = 'visible' and archived_at is null
                        and tipo = 'critica'),
    'participants', (select count(distinct device_id) from public.ideas
                      where status = 'visible' and archived_at is null),
    'areas',        (select count(*) from public.categories),
    'by_category',  coalesce((
      select json_agg(row_to_json(t))
      from (
        select c.slug, c.label, c.emoji, c.color,
               count(i.id)::int as total
        from public.categories c
        left join public.ideas i
          on i.category = c.slug
         and i.status = 'visible'
         and i.archived_at is null
        group by c.slug, c.label, c.emoji, c.color, c.sort_order
        order by c.sort_order
      ) t
    ), '[]'::json)
  );
$fn$;

grant execute on function public.arbolia_stats() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. VERIFICACIÓN CONTRA LA BASE REAL
--
--    Se insertan filas y se comprueba lo que efectivamente quedó, en vez
--    de dar por hecho que las sentencias de arriba hicieron lo que dicen.
--    Si algo no da, la excepción revierte TODA la migración —el SQL Editor
--    corre el archivo en una sola transacción— y las filas de prueba se
--    van con ella.
-- ---------------------------------------------------------------------
do $check$
declare
  sobrecargas      int;
  publica          boolean;
  antes            json;
  despues          json;
  antes_ideas      int;
  antes_propuestas int;
  antes_criticas   int;
begin
  -- Una sola versión del RPC, o PostgREST falla con PGRST203.
  select count(*) into sobrecargas
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'arbolia_submit_idea';

  if sobrecargas <> 1 then
    raise exception
      'La migración NO se aplicó. Quedaron % versiones de arbolia_submit_idea.', sobrecargas;
  end if;

  -- La pantalla tiene que poder leer el tipo.
  select has_column_privilege('anon', 'public.ideas', 'tipo', 'SELECT') into publica;
  if not publica then
    raise exception
      'La pantalla no puede leer ideas.tipo, así que no podría distinguir una crítica de una propuesta.';
  end if;

  -- Y los datos internos tienen que seguir cerrados.
  if has_column_privilege('anon', 'public.ideas', 'author_name', 'SELECT')
     or has_column_privilege('anon', 'public.ideas', 'age_range', 'SELECT')
     or has_column_privilege('anon', 'public.ideas', 'device_id', 'SELECT')
     or has_column_privilege('anon', 'public.ideas', 'revision_motivo', 'SELECT') then
    raise exception
      'Un dato interno quedó legible por el público. Revisá los grants de la 006.';
  end if;

  /*
   * Se comparan DIFERENCIAS, no valores absolutos.
   *
   * La base ya tiene ideas cargadas de las pruebas, y todas pasan a ser
   * 'propuesta' por el default de arriba. Un chequeo del estilo
   * "propuestas = 2" abortaría la migración entera por una fila previa que
   * no tiene nada que ver.
   */
  antes := arbolia_stats();
  antes_ideas      := (antes ->> 'ideas')::int;
  antes_propuestas := (antes ->> 'propuestas')::int;
  antes_criticas   := (antes ->> 'criticas')::int;

  -- Una propuesta y una crítica, por el mismo camino que usa el celular.
  perform public.arbolia_submit_idea(
    'Mas colectivos por la avenida Mate de Luna los fines de semana',
    'movilidad', 'chk009-propuesta', null, '30-44', false, null, 'propuesta');

  perform public.arbolia_submit_idea(
    'El municipio no limpia el barrio hace meses, hay basura por todos lados',
    'ambiente', 'chk009-critica', null, '45-59', false, null, 'critica');

  -- Un tipo inventado tiene que caer a 'propuesta', no romper el envío.
  perform public.arbolia_submit_idea(
    'Una plaza con juegos accesibles en el barrio',
    'espacios', 'chk009-basura', null, null, false, null, 'cualquier-cosa');

  if (select count(*) from public.ideas
       where device_id = 'chk009-basura' and tipo = 'propuesta') <> 1 then
    raise exception 'Un tipo desconocido no cayó a "propuesta" como corresponde.';
  end if;

  despues := arbolia_stats();

  if (despues ->> 'criticas')::int <> antes_criticas + 1 then
    raise exception
      'arbolia_stats no contó la crítica: pasó de % a %.',
      antes_criticas, despues ->> 'criticas';
  end if;
  if (despues ->> 'propuestas')::int <> antes_propuestas + 2 then
    raise exception
      'arbolia_stats no contó las propuestas: pasó de % a %.',
      antes_propuestas, despues ->> 'propuestas';
  end if;
  if (despues ->> 'ideas')::int <> antes_ideas + 3 then
    raise exception
      'La crítica no cuenta para el total. Tiene que contar: participó igual que cualquier otra.';
  end if;

  delete from public.ideas where device_id like 'chk009-%';

  raise notice
    'OK: la crítica se guarda, cuenta para la meta y la pantalla puede distinguirla. Las filas de prueba se borraron.';
end;
$check$;
