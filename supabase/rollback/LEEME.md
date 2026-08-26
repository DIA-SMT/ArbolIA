# Reversión

**Nada de esta carpeta se ejecuta durante la instalación normal.**

Las migraciones van en `supabase/migrations/` y se corren en orden. Acá
adentro está solamente el deshacer, por si algo sale mal en vivo durante
ExpoCom y hay que volver al estado anterior rápido.

| Archivo | Qué revierte |
|---|---|
| `revertir-007-y-008.sql` | El filtro leet y la revisión semántica: deja la base como estaba después de la migración 006. |

Estaba antes en `migrations/` con nombre `008-revision-ia.rollback.sql`.
Se movió porque un archivo que empieza con "008" dentro de una carpeta de
migraciones se ejecuta por accidente, y éste hace justo lo contrario de
lo que uno querría a esa hora.
