-- =====================================================================
--  Migración 003 — colores de área verificados
--
--  Los colores identifican el área en la copa del árbol y en el panel. Los
--  anteriores tenían dos problemas medidos con el validador de paleta,
--  comparando todos los pares:
--
--    · Comunidad y Movilidad se confundían con visión normal (ΔE 6.9)
--    · Urbanismo y Espacios públicos eran indistinguibles para daltonismo
--      (ΔE 0.3 en deuteranopía)
--    · Transporte y Tecnología quedaban por debajo del piso (ΔE 14.6)
--
--  Con estos valores pasan a ΔE 13.8 y 5.4 respectivamente.
--
--  Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

update public.categories set color = '#4ade80' where slug = 'ambiente';
update public.categories set color = '#67e8f9' where slug = 'movilidad';
update public.categories set color = '#8b5cf6' where slug = 'espacios';
update public.categories set color = '#facc15' where slug = 'tecnologia';
update public.categories set color = '#f97316' where slug = 'transporte';
update public.categories set color = '#f9a8d4' where slug = 'cultura';
update public.categories set color = '#60a5fa' where slug = 'urbanismo';
update public.categories set color = '#14b8a6' where slug = 'comunidad';
