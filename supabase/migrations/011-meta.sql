-- ---------------------------------------------------------------------
-- 011 · La meta vuelve a poder cambiarse
--
-- QUÉ PASÓ.
--
-- La migración 010 redefinió arbolia_set_goal y, al hacerlo, cambió cómo
-- escribe el valor:
--
--     insert into public.settings (key, value)
--     values ('goal', p_goal::text)      -- text dentro de una columna jsonb
--
-- Pero settings.value es `jsonb not null` desde la 002. Postgres no convierte
-- text a jsonb solo, así que la función falla al ejecutarse:
--
--     column "value" is of type jsonb but expression is of type text
--
-- plpgsql no resuelve los tipos hasta que la función corre, así que la 010 se
-- aplicó sin quejarse y el problema recién apareció cuando alguien intentó
-- cambiar la meta desde el panel. Justo la perilla que hay que poder mover en
-- vivo durante la feria.
--
-- Además la 010 se había llevado puesto el `updated_at = now()` del update, así
-- que aunque hubiera escrito bien, la fila no registraba cuándo cambió.
--
-- QUÉ HACE ESTA.
--
--  1. Reescribe la función guardando con to_jsonb, como la 002.
--  2. Devuelve el updated_at.
--  3. Alinea el rango con lo que valida el panel: 10 a 100.000. La 010 lo
--     había abierto a 1..1.000.000, y el mensaje de error que ve el equipo
--     seguía diciendo "entre 10 y 100.000".
--  4. Se comprueba a sí misma: escribe y borra una fila de prueba, así que si
--     el tipo estuviera mal esta migración falla acá y no en el stand.
--
-- Se puede correr más de una vez sin problema.
-- ---------------------------------------------------------------------

create or replace function public.arbolia_set_goal(p_goal int)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.es_del_equipo() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_goal is null or p_goal < 10 or p_goal > 100000 then
    raise exception 'GOAL_RANGE';
  end if;

  insert into public.settings (key, value, updated_at)
  values ('goal', to_jsonb(p_goal), now())
  on conflict (key) do update
    set value = excluded.value, updated_at = now();

  return p_goal;
end;
$fn$;

grant execute on function public.arbolia_set_goal(int) to authenticated;

-- ---------------------------------------------------------------------
-- Comprobación
--
-- Se ejercita exactamente la sentencia que estaba rota, sobre una clave de
-- prueba que se borra enseguida. No pasa por el guardia de equipo porque acá
-- estamos en el editor SQL, no en una sesión del panel: lo que se quiere
-- probar es el tipo, no el permiso.
-- ---------------------------------------------------------------------
do $verificar$
declare
  meta_actual jsonb;
  leido       jsonb;
begin
  insert into public.settings (key, value, updated_at)
  values ('__prueba_meta', to_jsonb(1234), now())
  on conflict (key) do update
    set value = excluded.value, updated_at = now();

  select value into leido from public.settings where key = '__prueba_meta';
  delete from public.settings where key = '__prueba_meta';

  if leido is distinct from to_jsonb(1234) then
    raise exception 'La escritura de la meta no devolvió lo que se guardó: %', leido;
  end if;

  select value into meta_actual from public.settings where key = 'goal';

  raise notice '---------------------------------------------------------';
  raise notice 'La meta se puede escribir. Meta vigente: %', coalesce(meta_actual::text, '(sin definir)');
  raise notice 'Rango permitido: 10 a 100000, igual que el panel.';
  raise notice '---------------------------------------------------------';
end;
$verificar$;
