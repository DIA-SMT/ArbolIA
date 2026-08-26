-- =====================================================================
--  ARBOLIA - Arbol Virtual de Ideas | La Ciudad Te Escucha
--  Municipalidad de San Miguel de Tucuman - ExpoCom 2026
--  Esquema Postgres + RLS + moderacion + realtime
--  Ejecutar completo en el SQL Editor de Supabase.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CATEGORIAS
--    Fijas: 8 areas de la ciudad. Cada una es una rama del arbol.
-- ---------------------------------------------------------------------
create table if not exists public.categories (
  slug        text primary key,
  label       text not null,
  emoji       text not null,
  color       text not null,          -- hex, usado por el render 3D
  branch_slot smallint not null,      -- posicion angular de la rama (0..7)
  sort_order  smallint not null
);

insert into public.categories (slug, label, emoji, color, branch_slot, sort_order) values
  ('ambiente',   'Ambiente',          '🌳', '#4ade80', 0, 1),
  ('movilidad',  'Movilidad',         '🚲', '#67e8f9', 1, 2),
  ('espacios',   'Espacios públicos', '🏙️', '#8b5cf6', 2, 3),
  ('tecnologia', 'Tecnología',        '💡', '#facc15', 3, 4),
  ('transporte', 'Transporte',        '🚌', '#f97316', 4, 5),
  ('cultura',    'Cultura',           '🎭', '#f9a8d4', 5, 6),
  ('urbanismo',  'Urbanismo',         '🏘️', '#60a5fa', 6, 7),
  ('comunidad',  'Comunidad',         '🤝', '#14b8a6', 7, 8)
on conflict (slug) do update
  set label       = excluded.label,
      emoji       = excluded.emoji,
      color       = excluded.color,
      branch_slot = excluded.branch_slot,
      sort_order  = excluded.sort_order;

-- ---------------------------------------------------------------------
-- 2. IDEAS
--    status: visible | flagged (filtro automatico) | hidden (admin)
--    archived_at: reinicio blando de estadisticas, no borra datos.
-- ---------------------------------------------------------------------
create table if not exists public.ideas (
  id          uuid primary key default gen_random_uuid(),
  text        text not null,
  category    text not null default 'comunidad' references public.categories(slug),
  device_id   text not null,
  status      text not null default 'visible',
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  constraint ideas_text_len   check (char_length(btrim(text)) between 3 and 180),
  constraint ideas_status_chk check (status in ('visible','flagged','hidden'))
);

create index if not exists ideas_live_idx
  on public.ideas (created_at desc)
  where status = 'visible' and archived_at is null;

create index if not exists ideas_device_idx   on public.ideas (device_id, created_at desc);
create index if not exists ideas_category_idx on public.ideas (category);

-- ---------------------------------------------------------------------
-- 3. EVENTOS DE MODERACION
--    La pantalla no puede "ver" una idea que paso a hidden (RLS la oculta),
--    asi que necesita un canal aparte para enterarse de que debe sacar la hoja.
-- ---------------------------------------------------------------------
create table if not exists public.moderation_events (
  id         bigserial primary key,
  idea_id    uuid not null,
  action     text not null check (action in ('hidden','restored','archived_all')),
  created_at timestamptz not null default now()
);

create index if not exists moderation_events_idx on public.moderation_events (created_at desc);

-- ---------------------------------------------------------------------
-- 4. LISTA DE PALABRAS BLOQUEADAS
--    El filtro corre en el servidor con un trigger: da igual lo que haga
--    el cliente, una idea con termino bloqueado nunca nace 'visible'.
-- ---------------------------------------------------------------------
create table if not exists public.blocked_words (
  word text primary key
);

insert into public.blocked_words (word) values
  ('puto'),('puta'),('putos'),('putas'),('mierda'),('conchudo'),
  ('pelotudo'),('pelotuda'),('boludo'),('boluda'),('forro'),('forra'),
  ('carajo'),('joder'),('cagada'),('verga'),('pija'),('choto'),
  ('trolo'),('trola'),('sorete'),('imbecil'),('idiota'),('estupido'),
  ('negro de mierda'),('villero'),('sudaca'),('maricon'),
  ('hijo de puta'),('la concha de'),('andate a la'),
  ('ladron'),('ladrones'),('chorro'),('chorros'),('coima'),('coimero'),
  ('fuck'),('shit'),('bitch'),('asshole')
on conflict (word) do nothing;

-- ---------------------------------------------------------------------
-- 5. NORMALIZACION DE TEXTO
--    Baja a minusculas, saca tildes y colapsa espacios, para que
--    "P U T O", "PUTO" y "putó" caigan todos en el mismo filtro.
-- ---------------------------------------------------------------------
create or replace function public.arbolia_normalize(txt text)
returns text
language sql
immutable
as $fn$
  select regexp_replace(
    translate(
      lower(btrim(txt)),
      'áàäâãéèëêíìïîóòöôõúùüûñç',
      'aaaaaeeeeiiiiooooouuuunc'
    ),
    '\s+', ' ', 'g'
  );
$fn$;

-- ---------------------------------------------------------------------
-- 6. TRIGGER DE MODERACION + RATE LIMIT
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

  -- Tope por dispositivo: 12 ideas por hora.
  select count(*) into recent_count
  from public.ideas
  where device_id = new.device_id
    and created_at > now() - interval '1 hour';

  if recent_count >= 12 then
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

-- Cuando el admin oculta o restaura, se emite el evento para la pantalla.
create or replace function public.arbolia_emit_moderation()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.status is distinct from old.status then
    if new.status in ('hidden','flagged') then
      insert into public.moderation_events (idea_id, action) values (new.id, 'hidden');
    elsif new.status = 'visible' then
      insert into public.moderation_events (idea_id, action) values (new.id, 'restored');
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_emit_moderation on public.ideas;
create trigger trg_emit_moderation
  after update on public.ideas
  for each row execute function public.arbolia_emit_moderation();

-- ---------------------------------------------------------------------
-- 7. ESTADISTICAS EN VIVO
--    "Ciudadanos participando" = dispositivos unicos con al menos una idea
--    publicada. Nunca infla el numero: es gente que efectivamente participo.
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

-- ---------------------------------------------------------------------
-- 8. REINICIO DE ESTADISTICAS (solo admin autenticado)
--    Archiva, no borra: los datos de ExpoCom se conservan para analisis.
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
  if auth.role() is distinct from 'authenticated' then
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

-- ---------------------------------------------------------------------
-- 9. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.ideas             enable row level security;
alter table public.categories        enable row level security;
alter table public.moderation_events enable row level security;
alter table public.blocked_words     enable row level security;

-- Categorias: lectura publica.
drop policy if exists categories_read on public.categories;
create policy categories_read on public.categories
  for select using (true);

-- Ideas: el publico ve solo lo publicado y no archivado.
drop policy if exists ideas_public_read on public.ideas;
create policy ideas_public_read on public.ideas
  for select using (status = 'visible' and archived_at is null);

-- Ideas: el público NO escribe directo en la tabla. Todo envío pasa por
-- arbolia_submit_idea (ver mas abajo). Con INSERT directo, una idea marcada
-- por el filtro no puede devolverse al cliente —la politica de lectura no la
-- deja ver— y el envio falla aunque la idea se haya guardado bien.

-- Ideas: el equipo municipal autenticado ve y modera todo.
drop policy if exists ideas_admin_read on public.ideas;
create policy ideas_admin_read on public.ideas
  for select to authenticated using (true);

drop policy if exists ideas_admin_update on public.ideas;
create policy ideas_admin_update on public.ideas
  for update to authenticated using (true) with check (true);

-- Eventos de moderacion: lectura publica (la pantalla los necesita).
drop policy if exists moderation_read on public.moderation_events;
create policy moderation_read on public.moderation_events
  for select using (true);

-- Palabras bloqueadas: solo el admin las ve y las edita.
drop policy if exists blocked_admin on public.blocked_words;
create policy blocked_admin on public.blocked_words
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------
-- 9b. ENVIO DE IDEAS
--     Devuelve solo el estado del envio propio. Las ideas marcadas para
--     revision siguen sin poder leerse desde el cliente.
-- ---------------------------------------------------------------------
create or replace function public.arbolia_submit_idea(
  p_text      text,
  p_category  text,
  p_device_id text
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

  insert into public.ideas (text, category, device_id)
  values (p_text, p_category, p_device_id)
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

-- ---------------------------------------------------------------------
-- 10. REALTIME
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.ideas;
alter publication supabase_realtime add table public.moderation_events;

-- Necesario para que los eventos UPDATE lleguen con la fila completa.
alter table public.ideas replica identity full;

-- ---------------------------------------------------------------------
-- 11. PERMISOS DE EJECUCION
-- ---------------------------------------------------------------------
grant execute on function public.arbolia_stats()       to anon, authenticated;
grant execute on function public.arbolia_submit_idea(text, text, text) to anon, authenticated;
grant execute on function public.arbolia_reset_stats() to authenticated;
