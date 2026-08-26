# Árbol Virtual de Ideas — La Ciudad Te Escucha

Instalación interactiva para **ExpoCom Tucumán 2026**.
Municipalidad de San Miguel de Tucumán.

Los vecinos dejan ideas para mejorar la ciudad desde su celular escaneando un QR.
Cada idea se convierte en una hoja luminosa que brota en un árbol digital en la
pantalla del stand, en vivo y delante de todos.

> Una ciudad también se construye escuchando a quienes la habitan.

---

## Las tres pantallas

Un solo proyecto, un solo deploy, tres rutas:

| Ruta | Para quién | Qué hace |
|---|---|---|
| `/` | La pantalla LED / proyector del stand | Árbol 3D, contadores en vivo, QR |
| `/idea` | El celular del vecino (destino del QR) | Escribir y enviar una idea |
| `/admin` | El equipo municipal | Moderar, filtrar, ver métricas, reiniciar |

El motor 3D sólo lo descarga la pantalla. El celular que entra por el QR baja
**~131 kB gzip**, sin Three.js.

---

## Puesta en marcha

### 1. Base de datos

En el proyecto de Supabase, abrir el **SQL Editor** y ejecutar, en orden:

1. `supabase/schema.sql` — tablas, filtro de contenido, límite de envíos,
   políticas de seguridad (RLS) y Realtime.
2. `supabase/migrations/001-submit-idea.sql`
3. `supabase/migrations/002-panel.sql`

Las migraciones ya están incluidas dentro de `schema.sql` para instalaciones
nuevas; sólo hacen falta por separado si la base se creó antes de que
existieran.

Para verificar que quedó todo bien:

```bash
npm run check:supabase
```

### 2. Usuario del panel de moderación

En Supabase → **Authentication → Users → Add user**, crear una cuenta con correo
y contraseña para el equipo. No hay registro abierto: sólo entra quien tenga un
usuario creado a mano.

### 3. Variables de entorno

Copiar `.env.example` a `.env` y completar:

```bash
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
VITE_PUBLIC_URL=https://arbolia.vercel.app
VITE_GOAL=500
```

`VITE_PUBLIC_URL` es la que se codifica en el QR. Tiene que ser la URL pública
real del deploy, no `localhost`, o el QR del stand no va a funcionar.

### 4. Local

```bash
npm install
```

```bash
npm run dev
```

Sin credenciales de Supabase la app arranca igual, en **modo demostración**: el
árbol se llena con ideas simuladas. Sirve para trabajar el visual sin backend.

### 5. Deploy en Vercel

Framework preset **Vite**. Cargar las cuatro variables de entorno en el proyecto
de Vercel (Settings → Environment Variables) y desplegar. El `vercel.json` ya
incluye el rewrite de SPA que necesitan las rutas.

---

## Comandos

```bash
npm run dev
```

```bash
npm run build
```

```bash
npm run typecheck
```

```bash
npm run check
```

Dos verificaciones que corren sin navegador. Conviene pasarlas si se tocan los
parámetros del árbol o la rotación de etiquetas.

`check:tree` — geometría: que no haya coordenadas inválidas, que ninguna hoja
quede dentro del tronco o bajo tierra, que las 8 ramas estén separadas, que haya
posiciones suficientes para la meta y que el recorrido de la partícula termine
exactamente en la hoja.

`check:labels` — rotación de etiquetas: que nunca se muestre la misma idea en
dos etiquetas a la vez y que con el tiempo aparezcan todas.

`check:layout` — colisión de etiquetas: que dos ideas que caen en hojas
cercanas no terminen con los textos encimados.

Y contra la base, cuando hay credenciales:

```bash
npm run check:supabase
```

Recorre el camino crítico completo: envío, límite de envíos, filtro de
moderación, que RLS esconda lo marcado, **que la consulta de la pantalla nunca
devuelva nada sin publicar**, la meta, la evolución por hora y el tiempo real.

---

## Cómo funciona

### Recorrido de una idea

```
Celular  →  Supabase (trigger de moderación)  →  Realtime  →  Pantalla
                                                                 ↓
                              partícula desde la raíz → tronco → rama → hoja
```

1. El vecino envía desde `/idea`.
2. Un trigger de Postgres valida el texto, aplica el límite de envíos y decide
   si la idea nace `visible` o `flagged`.
3. Supabase Realtime avisa a la pantalla.
4. Una partícula de luz sale de una raíz, sube el tronco, recorre la rama de su
   categoría y planta la hoja. Aparece la burbuja con el texto.
5. Los contadores suben con una animación de destello.

### Las 8 áreas

Cada categoría tiene una rama fija del árbol y un color propio. La rama de
`movilidad` está siempre en el mismo sector: quien vuelve al stand encuentra su
zona donde la dejó.

🌳 Ambiente · 🚲 Movilidad · 🏙️ Espacios públicos · 💡 Tecnología
🚌 Transporte · 🎭 Cultura · 🏘️ Urbanismo · 🤝 Comunidad

### Evolución del árbol

Los tramos siguen la meta vigente. Con una meta de 500:

| Ideas | Etapa | Tamaño | Follaje | Raíces |
|---|---|---|---|---|
| 0 – 100 | Brote | 52–72 % | 2.400 hojas | 40–56 % desplegadas |
| 100 – 250 | Joven | 72–90 % | 3.400 hojas | 56–73 % |
| 250 – 500 | Frondoso | 90–110 % | 3.900 hojas | 73–90 % |
| 500+ | Pleno | 110–130 % | 4.200 hojas | completas |

Las raíces **se extienden con la participación**, no sólo la copa. La geometría
se genera siempre a largo completo y el shader recorta lo que todavía no creció,
con una punta encendida en el frente de avance. Sale más barato que regenerar
geometría y se ve mejor: la raíz avanza de verdad hacia afuera en vez de
estirarse de golpe. Cada raíz principal se bifurca en secundarias, así que
cuanto más participa la gente, más se ramifica la base — que es justamente lo
que la instalación quiere decir.

Todos los cambios se interpolan muy lento: entre una idea y la siguiente son
imperceptibles, y a lo largo de una jornada el árbol se agranda de verdad. Un
salto al cruzar el umbral de una etapa se leería como un error de render.

Al 20 %, al 50 % y al 100 % de la meta hay celebración: estallido de partículas desde
toda la copa, subida de bloom y cartel en pantalla.

### Las etiquetas de ideas

Alrededor de la copa flotan tres etiquetas, cada una anclada con una línea fina
a la hoja de su idea. Las de la cara oculta del árbol se atenúan solas, para que
no floten por delante del tronco como si estuvieran adelante.

Un resolvedor central las separa cuando dos ideas caen en hojas cercanas. Está
centralizado a propósito: cuando cada etiqueta se ubicaba sola no tenía forma de
saber dónde estaban las otras, y los textos terminaban encimados e ilegibles. El
desplazamiento sólo baja y se interpola entre cuadros, porque la cámara orbita y
el orden vertical cambia — sin suavizado los textos saltarían al cruzarse.

Rotan **sobre todo el histórico**, no sobre las últimas tres. Cambia una cada 7
segundos, de forma escalonada. Así la pantalla nunca queda congelada mostrando
lo mismo cuando baja la participación, y una idea que alguien dejó a la mañana
vuelve a verse a la tarde.

| Ideas acumuladas | Vuelta completa al histórico |
|---|---|
| 50 | ~6 min |
| 120 | ~14 min |
| 300 | ~35 min |
| 500 | ~58 min |

Cuando llega una idea nueva entra al instante, sin esperar su turno, con un halo
de su color que se apaga solo.

### Las hojas no se mueven de lugar

La posición de cada hoja se deriva del ID de la idea con un generador
determinista, no de `Math.random()`. Si hay que recargar la pantalla a mitad de
la expo, el árbol se reconstruye idéntico y nadie pierde su hoja.

---

## Moderación

Es el riesgo principal de una instalación con texto libre en pantalla gigante.
Hay tres capas:

1. **Filtro en el celular** — avisa en el momento para que la persona corrija,
   en vez de aceptar en silencio algo que nunca va a aparecer.
2. **Trigger en Postgres** — corre siempre, sin importar lo que haga el cliente.
   Normaliza el texto (minúsculas, sin tildes) y detecta evasiones tipo
   `p-u-t-o`. Lo que cae acá nace `flagged` y **nunca llega a la pantalla**.
3. **Panel `/admin`** — cola de "Pendientes de revisión" para decidir a mano, y
   botón de retirar cualquier idea ya publicada. La hoja desaparece de la
   pantalla en el acto.

Para ampliar la lista de términos bloqueados, agregar filas a la tabla
`blocked_words` en Supabase. Tiene efecto inmediato, sin redeploy.

## Tamaños de pantalla

Medido en el navegador, no estimado. Sin scroll ni desbordes en ninguno:

| Resolución | Uso | Pregunta | Estado |
|---|---|---|---|
| 1920 × 1080 | LED / proyector típico | 48 px | ✅ referencia de calibración |
| 3840 × 2160 | LED 4K | 95 px | ✅ |
| 3440 × 1440 | ultra-wide | 80 px | ✅ |
| 1366 × 768 | notebook de pruebas | 34 px | ✅ |
| 1080 × 1920 | tótem vertical | 80 px | ✅ columnas pasan a filas |

Todos los cuerpos salen de **una sola variable**, `--u` en `overlay.css`. Es el
único número a tocar si el LED del stand pide más o menos cuerpo:

```
--u: clamp(11px, min(0.9vw, 2vh), 34px);
```

El `min()` con `vh` sólo entra en juego en pantallas ultra-anchas, donde sobra
ancho pero no alto.

### Web móvil

| Resolución | Estado |
|---|---|
| 375 × 812 (iPhone) | ✅ entra completa sin scroll |
| 360 × 640 (Android corto) | ✅ funcional; la nota de privacidad queda 23 px bajo el pliegue |

El textarea está en 16 px reales en todos los tamaños: menos que eso y iOS hace
zoom al enfocar, que descoloca el formulario. Los chips de categoría no bajan de
42 px de alto para que se puedan tocar de pie y con una mano.

### Atajos en la pantalla

| Tecla | Acción |
|---|---|
| `Ctrl + H` | Oculta la burbuja de texto actual |
| `F` | Pantalla completa |
| `D` | Muestra u oculta el panel de diagnóstico (si se abrió con `?diag`) |

### Parámetros de URL para el armado

| URL | Para qué |
|---|---|
| `/?diag` | Panel con tamaño de canvas, fps, objetos, llamadas de dibujo y triángulos |
| `/?fx=off` | Apaga bloom y viñeta. Si la PC del stand no da, la instalación igual corre |

Sirven para el día del montaje: si la pantalla se ve mal, `?diag` dice si el
problema es de render, de rendimiento o de encuadre, sin tener que adivinar.

`Ctrl + H` es el botón de pánico: si algo se cuela, saca el texto de la vista sin
cortar la animación ni dejar la pantalla en negro.

---

## El panel

En `/admin`, con usuario y contraseña de Supabase Auth.

**Moderación en tiempo real.** Las ideas aparecen en la lista apenas entran a la
base. Antes era un refresco cada 12 segundos, y para moderar no alcanzaba: si se
cuela una grosería, esos 12 segundos son 12 segundos con el texto proyectado
delante del público. Queda igual un refresco cada 45 s como red, por si el
socket se cae — el WiFi de un predio de expo no es confiable.

**Evolución por hora.** Barras apiladas: lo publicado abajo, lo marcado para
revisión arriba. Sirve para ver en qué franjas hay más gente y reforzar el stand
ahí. Las horas se calculan en hora de Tucumán, no en UTC: con UTC el pico de las
18 aparecería a las 21 y el gráfico sería inútil para decidir. Las horas sin
ideas se incluyen igual, porque un gráfico que las saltea hace parecer continuo
lo que fue a los tirones. Rango de 12, 24 o 72 horas, y vista de tabla.

**Meta editable.** La meta vive en la base, no en el build. Si el primer día la
participación va mucho más rápido o mucho más lento de lo previsto, se mueve
desde el panel y la pantalla la toma sola en menos de 30 segundos, sin
redesplegar. Los tramos de crecimiento del árbol se recalculan con la meta nueva.

## Dos clientes de Supabase

La pantalla y el celular usan un cliente con `persistSession: false`; el panel,
otro con sesión persistida.

No es un detalle de implementación. Con un solo cliente pasó esto: alguien del
equipo abría `/admin` en la misma máquina de la pantalla, Supabase guardaba la
sesión, y la pantalla pasaba a consultar como usuario autenticado. Las políticas
de RLS son **permisivas —se suman con OR—**, así que la regla del panel
(`to authenticated using (true)`) le daba acceso a todo: **las ideas moderadas
aparecían proyectadas en el árbol**.

Además de los dos clientes, las consultas de la pantalla filtran por estado de
forma explícita. Es redundante con RLS a propósito: si mañana alguien agrega una
política permisiva, el agujero sigue tapado. `npm run check:supabase` verifica
las dos capas.

## Sobre los números

**"Ciudadanos participando"** cuenta dispositivos únicos que enviaron al menos
una idea publicada. Va a ser un número *menor* que el de ideas, y está bien:
significa que hubo gente que participó más de una vez.

Se eligió así a propósito. Contar "personas que miraron" habría dado un número
más alto, pero sería inflar una métrica en una comunicación institucional, y eso
no se sostiene si alguien pregunta cómo se mide.

---

## Operación durante ExpoCom

### Antes de abrir

- [ ] Abrir `/` en la PC del stand y poner **pantalla completa** con `F`.
- [ ] Confirmar que abajo a la derecha **no** aparezca el cartel de estado
      (si aparece "Reconectando", hay problema de red).
- [ ] Escanear el QR con un celular ajeno a la red del stand y enviar una idea
      de prueba. Verificar que la hoja brote en la pantalla.
- [ ] Retirar esa idea de prueba desde `/admin`.
- [ ] Dejar `/admin` abierto en una notebook aparte, con sesión iniciada.
- [ ] Desactivar la suspensión de pantalla y el protector de la PC.

### Durante

- La pantalla se recupera sola: si se cae el WebSocket pasa a consultar por
  intervalos y sigue recibiendo ideas. Si se pierde el contexto WebGL, recarga
  sola en 1,5 s.
- Si baja el rendimiento, la instalación reduce calidad automáticamente en vez
  de arrastrarse.
- Revisar cada tanto la tarjeta **"Pendientes de revisión"** en `/admin`.

### Si algo falla

| Síntoma | Qué hacer |
|---|---|
| Pantalla negra | `F5`. El árbol se reconstruye igual, no se pierde nada |
| Dice "Reconectando" | Problema de red del predio; sigue recibiendo por intervalos |
| No entran ideas | Probar `/idea` desde un celular con datos móviles |
| Apareció algo indebido | `Ctrl+H` en la pantalla, después retirarlo desde `/admin` |

### Después

El botón **Reiniciar estadísticas** de `/admin` archiva las ideas, no las borra.
Todos los datos de ExpoCom quedan en la tabla `ideas` con `archived_at` cargado,
listos para analizar qué pidió la gente y en qué áreas.

---

## Stack

React 19 · TypeScript · Vite · Three.js + React Three Fiber · Supabase
(Postgres + Realtime + Auth) · Vercel

El árbol es **procedural**: tronco, raíces, ramas y posiciones de hoja se generan
por código, no son un modelo 3D. Por eso puede crecer de verdad con la
participación en vez de intercambiar tres modelos distintos.

Hasta 1400 hojas se dibujan con `InstancedMesh` y el viento se resuelve en el
vertex shader, así que el costo por hoja en CPU es cero. Sin eso, una GPU
integrada de PC de stand no llegaría.
