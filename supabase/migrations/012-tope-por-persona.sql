-- ---------------------------------------------------------------------
-- 012 · Tope de ideas por persona, configurable
--
-- El tope era 12 ideas por hora y por dispositivo. Para un stand de feria es
-- mucho: una sola persona podía llenar doce hojas mientras otros esperan el
-- turno, y el árbol dejaba de contar la ciudad para contar a quien más
-- insistió. El equipo lo baja a 3.
--
-- POR QUÉ CONFIGURABLE Y NO UN NÚMERO FIJO.
--
-- Si mañana 3 resulta corto —un vecino quiere agregar una idea de otra área—
-- cambiarlo tiene que costar una línea, no una migración: recrear esta
-- función entera en el editor SQL en medio de la feria es exactamente el tipo
-- de maniobra donde se rompen cosas. Ya pasó una vez con la meta.
--
-- Para cambiarlo, una sola línea:
--
--   update public.settings set value = '4'::jsonb where key = 'tope_por_persona';
--
-- Toma efecto en el próximo envío, sin reiniciar nada. Si la fila no existe,
-- el tope vuelve solo a 3.
--
-- LO QUE NO CAMBIA: el enfriamiento de 12 segundos entre envíos del mismo
-- dispositivo, y que los dos límites son POR DISPOSITIVO y nunca por IP. En un
-- stand la gente comparte el WiFi del predio, así que un límite por IP contaría
-- a todos los vecinos juntos y frenaría a la cola entera por culpa del primero.
--
-- Se puede correr más de una vez sin problema.
-- ---------------------------------------------------------------------

insert into public.settings (key, value)
values ('tope_por_persona', '3'::jsonb)
on conflict (key) do nothing;

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
  tope         int;
  last_at      timestamptz;
begin
  new.text   := btrim(new.text);
  normalized := public.arbolia_normalize(new.text);

  -- Anti-evasion: "p-u-t-o" / "p u t o" colapsan a "puto".
  compact := regexp_replace(normalized, '[^a-z0-9]', '', 'g');

  -- Rate limit: 1 idea cada 12 segundos por dispositivo.
  select max(created_at) into last_at
  from public.ideas
  where device_id = new.device_id;

  if last_at is not null and last_at > now() - interval '12 seconds' then
    raise exception 'RATE_LIMIT_COOLDOWN'
      using hint = 'Esperá unos segundos antes de enviar otra idea.';
  end if;

  -- Tope por dispositivo, configurable sin migración. Ver la nota de arriba.
  select coalesce((select (value #>> '{}')::int
                   from public.settings
                   where key = 'tope_por_persona'), 3)
    into tope;

  select count(*) into recent_count
  from public.ideas
  where device_id = new.device_id
    and created_at > now() - interval '1 hour';

  if recent_count >= tope then
    raise exception 'RATE_LIMIT_HOURLY'
      using hint = 'Ya enviaste muchas ideas. Dejale lugar a otros vecinos.';
  end if;

  -- Filtro de contenido.
  if exists (
    select 1 from public.blocked_words b
    where normalized like '%' || b.word || '%'
       or compact    like '%' || replace(b.word, ' ', '') || '%'
  ) then
    new.status := 'flagged';
  end if;

  -- Texto sin ninguna letra (solo simbolos o numeros) tampoco entra al arbol.
  if normalized !~ '[a-z]' then
    new.status := 'flagged';
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_moderate_idea on public.ideas;
create trigger trg_moderate_idea
  before insert on public.ideas
  for each row execute function public.arbolia_moderate_idea();

-- ---------------------------------------------------------------------
-- Comprobación
-- ---------------------------------------------------------------------
do $verificar$
declare
  tope_leido int;
begin
  select (value #>> '{}')::int into tope_leido
  from public.settings where key = 'tope_por_persona';

  if tope_leido is null then
    raise exception 'No quedó guardado el tope por persona.';
  end if;

  raise notice '---------------------------------------------------------';
  raise notice 'Tope por persona: % ideas por hora (antes 12).', tope_leido;
  raise notice 'Enfriamiento entre envíos: 12 segundos. Los dos por DISPOSITIVO.';
  raise notice 'Para cambiarlo:';
  raise notice '  update public.settings set value = ''4''::jsonb where key = ''tope_por_persona'';';
  raise notice '---------------------------------------------------------';
end;
$verificar$;
