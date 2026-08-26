-- =====================================================================
--  Migración 007 — el filtro entiende sustituciones "leet"
--                  y deja de acusar propuestas legítimas
--
--  Un vecino escribió en el stand:
--
--    "Estoy harto de esta gestion de m1erd4, no hace nada"
--
--  y se publicó entero. El filtro compara palabras y ahí no hay ninguna de
--  la lista: 1 por i y 4 por a alcanzan para evadir cualquier lista de
--  términos, y es lo primero que prueba quien quiere colar algo.
--
--  Buscando eso apareció algo peor, que ya está pasando hoy en la base:
--
--    "Que la U.N.T. done computadoras para las escuelas municipales"
--
--  queda marcada para revisión. La tercera regla del filtro —la que atrapa
--  "p-u-t-o"— se abre con cualquier sigla punteada (U.N.T., D.N.I., C.G.M.)
--  o con un "A o B", y una vez abierta compara por SUBCADENA contra el
--  texto entero. Ahí "computadoras" contiene "puta" y "controlar" contiene
--  "trola": exactamente el problema que la migración 004 documentó y
--  arregló para las otras dos reglas, que quedó vivo en ésta.
--
--  Esta migración hace las dos cosas:
--    · agrega la comparación con los dígitos revertidos a letras;
--    · reescribe la tercera regla para que compacte ÚNICAMENTE la tira de
--      caracteres sueltos, y no la frase entera.
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
--
--    Se usa como comparación ADICIONAL, nunca en reemplazo: convertir
--    dígitos a letras en todo texto deformaría propuestas legítimas que
--    hablan de la ruta 9, del colectivo 118 o de plantar 100 árboles.
-- ---------------------------------------------------------------------
create or replace function public.arbolia_sin_leet(txt text)
returns text
language sql
immutable
as $fn$
  select translate(txt, '013457@$!', 'oieastasi');
$fn$;

-- ---------------------------------------------------------------------
-- 2. EL TRIGGER DE MODERACIÓN
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
  recent_count int;
  last_at      timestamptz;
begin
  new.text := btrim(new.text);
  -- El nombre vacío se guarda como NULL, no como cadena vacía.
  new.author_name := nullif(btrim(coalesce(new.author_name, '')), '');

  -- Propuesta y nombre se revisan juntos: una firma con un insulto quedaría
  -- proyectada igual que la propuesta.
  normalized := public.arbolia_normalize(new.text || ' ' || coalesce(new.author_name, ''));
  sin_leet   := public.arbolia_sin_leet(normalized);

  -- ---- Límites de envío por dispositivo -------------------------------

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

  -- 1. Palabra completa sobre el texto tal cual (ver migración 004).
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

  -- 3. Caracteres sueltos separados por símbolos: "p-u-t-o", "p u t o",
  --    "p!u@t$o", "p-u-7-0".
  --
  --    Se compacta ÚNICAMENTE la tira suelta, nunca la frase entera. Es
  --    toda la diferencia: "computadoras" no tiene separadores adentro, así
  --    que jamás forma parte de una tira y nunca se pega a lo que sigue.
  --    Una sigla sí forma tira, pero "u.n.t." compacta a "unt", que no es
  --    palabra de nadie.
  --
  --    Los símbolos se sacan ANTES de revertir el leet, para que "p!u@t$o"
  --    dé "puto" y no "piuatso".
  else
    if exists (
      select 1
      from regexp_matches(
             normalized,
             '(^|[^a-z0-9])((?:[a-z0-9][^a-z0-9]+){2,}[a-z0-9])([^a-z0-9]|$)',
             'g'
           ) as m(partes)
      cross join public.blocked_words b
      where public.arbolia_sin_leet(regexp_replace(m.partes[2], '[^a-z0-9]', '', 'g'))
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
-- 3. VERIFICACIÓN CONTRA EL TRIGGER REAL
--
--    Se insertan filas de prueba y se comprueba el estado que les asigna
--    el trigger recién instalado, en vez de reimplementar la comparación
--    acá al lado. Una regex mal escrita no falla al crear la función:
--    fallaría en el primer envío del stand. Así falla ahora.
--
--    Si algo no da, la excepción revierte TODA la migración —el SQL Editor
--    corre el archivo en una sola transacción— y las filas de prueba se
--    van con ella.
-- ---------------------------------------------------------------------
do $check$
declare
  r        record;
  obtenido text;
  n        int := 0;
begin
  for r in
    select * from (values
      -- Evasiones: tienen que quedar en la cola de revisión.
      ('Estoy harto de esta gestion de m1erd4, no hace nada',    '',                'flagged'),
      ('que pel0tud0 el intendente',                             '',                'flagged'),
      ('son unos l4dr0nes',                                      '',                'flagged'),
      ('p-u-t-o el que lee esto',                                '',                'flagged'),
      ('p-u-7-0 el que lee esto',                                '',                'flagged'),
      ('sos un b$o!l@u$d!o',                                     '',                'flagged'),
      ('Mas colectivos en la linea 4',                           'p.e.l.o.t.u.d.o', 'flagged'),

      -- Legítimas: si alguna queda marcada, la migración aborta.
      ('Plantar 100 arboles nativos en la avenida',              '',                'visible'),
      ('Mejorar la parada del 118 en la terminal',               '',                'visible'),
      ('Un carril exclusivo en la ruta 9',                       '',                'visible'),
      ('Que la U.N.T. done computadoras para las escuelas',      '',                'visible'),
      ('Tramitar el D.N.I. y poder controlar el turno online',   '',                'visible'),
      ('Sumar 1 contenedor de reciclaje en el C.G.M. Sur',       '',                'visible'),
      ('Poner un banco 1 mas en la plaza del C.I.C.',            '',                'visible'),
      ('Turnos del S.A.M.E. y mas control 4 veces por semana',   '',                'visible'),
      ('Elegir entre la opcion A o B en la consulta popular',    '',                'visible'),
      ('Mas computadoras en las escuelas municipales',           'M. A. S. Gomez',  'visible')
    ) as t(texto, autor, esperado)
  loop
    n := n + 1;

    insert into public.ideas (text, category, device_id, author_name)
    values (r.texto, 'comunidad', 'chk007-' || lpad(n::text, 3, '0'), nullif(r.autor, ''))
    returning status into obtenido;

    if obtenido is distinct from r.esperado then
      raise exception
        'La migración NO se aplicó (se revirtió todo). El caso "%" quedó "%" y se esperaba "%".',
        r.texto, obtenido, r.esperado
        using hint = 'Revisá la lista public.blocked_words: puede tener un término que no esperábamos.';
    end if;
  end loop;

  delete from public.ideas where device_id like 'chk007-%';

  raise notice
    'OK: % casos verificados contra el trigger real. El filtro atrapa las evasiones leet, no toca las ideas con números y ya no marca siglas ni "computadoras".',
    n;
end;
$check$;
