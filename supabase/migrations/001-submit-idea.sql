-- =====================================================================
--  Migración 001 — envío de ideas por función
--
--  Problema que resuelve
--  ---------------------
--  La app enviaba la idea con INSERT ... RETURNING para saber si había
--  quedado publicada o marcada para revisión. Pero la política de lectura
--  del público sólo deja ver status = 'visible', así que cuando el filtro
--  marcaba una idea como 'flagged', PostgREST no podía devolver la fila y
--  el envío fallaba con un error de RLS.
--
--  Para el vecino eso se veía así: escribía algo que el filtro atajaba, la
--  idea SE GUARDABA igual, pero la pantalla le decía "no pudimos enviar tu
--  idea". Reintentaba, chocaba contra el límite de 12 segundos, y se iba
--  pensando que la aplicación estaba rota.
--
--  Solución
--  --------
--  Una función SECURITY DEFINER que hace el insert y devuelve únicamente
--  el estado de SU propio envío. No abre la lectura de las ideas marcadas:
--  sigue sin poder leerse ninguna fila ajena. Los triggers de moderación y
--  de límite de envíos corren igual, y sus errores se propagan tal cual.
--
--  Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

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
  -- Mismas validaciones que tenía la política de INSERT.
  if char_length(btrim(p_text)) not between 3 and 180 then
    raise exception 'TEXT_LENGTH';
  end if;

  if char_length(p_device_id) not between 8 and 64 then
    raise exception 'DEVICE_ID';
  end if;

  if not exists (select 1 from public.categories where slug = p_category) then
    p_category := 'comunidad';
  end if;

  -- El trigger de moderación y el de límite corren acá dentro.
  insert into public.ideas (text, category, device_id)
  values (p_text, p_category, p_device_id)
  returning * into nueva;

  -- Sólo lo que el cliente necesita saber de su propio envío.
  return json_build_object(
    'id',         nueva.id,
    'text',       nueva.text,
    'category',   nueva.category,
    'status',     nueva.status,
    'created_at', nueva.created_at
  );
end;
$fn$;

grant execute on function public.arbolia_submit_idea(text, text, text) to anon, authenticated;

-- La política de INSERT directo ya no hace falta: todo el envío pasa por la
-- función. Se retira para que no queden dos caminos de escritura abiertos.
drop policy if exists ideas_public_insert on public.ideas;
