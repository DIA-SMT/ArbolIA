/**
 * Verificación de la resolución de colisiones entre etiquetas.
 *
 * Corre sin navegador. Comprueba lo que se veía mal en la pantalla: dos
 * ideas que caen en hojas cercanas terminaban con los textos encimados e
 * ilegibles.
 *
 *   npm run check:layout
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  acomodar,
  resolverColisiones,
  type CajaEtiqueta,
  type Zona,
} from '../src/routes/screen/labelLayout'

const MARGEN = 14
let fallos = 0

function check(label: string, ok: boolean, detalle = '') {
  const marca = ok ? 'OK  ' : 'FALLA'
  if (!ok) fallos++
  console.log(`  ${marca}  ${label}${detalle ? ` — ${detalle}` : ''}`)
}

/**
 * ¿Queda alguna superposición real después de aplicar los desplazamientos?
 *
 * Se miran LOS DOS EJES. Dos etiquetas a la misma altura pero en extremos
 * opuestos de la pantalla no se pisan, y exigirles separación vertical era
 * justamente lo que hacía temblar todo cuando la cámara orbitaba.
 */
function superpuestas(cajas: CajaEtiqueta[], offsets: number[]): number {
  const finales = cajas
    .map((c, i) => ({
      izq: c.x - c.ancho / 2,
      der: c.x + c.ancho / 2,
      arriba: c.y - c.alto / 2 + offsets[i],
      abajo: c.y + c.alto / 2 + offsets[i],
      visible: c.visible,
    }))
    .filter((c) => c.visible)

  let choques = 0
  for (let i = 0; i < finales.length; i++) {
    for (let j = i + 1; j < finales.length; j++) {
      const a = finales[i]
      const b = finales[j]
      if (a.arriba < b.abajo && b.arriba < a.abajo && a.izq < b.der && b.izq < a.der) choques++
    }
  }
  return choques
}

/** Por defecto, todas en la misma columna: el caso que se veía mal. */
const caja = (y: number, alto = 60, visible = true, x = 400, ancho = 150): CajaEtiqueta => ({
  x,
  ancho,
  y,
  alto,
  visible,
})

console.log('\nCOLISIÓN DE ETIQUETAS')

// --- El caso que se veía mal en pantalla ------------------------------
{
  // Tres etiquetas prácticamente en el mismo punto.
  const cajas = [caja(200), caja(210), caja(205)]
  const off = resolverColisiones(cajas, MARGEN)
  check('tres etiquetas encimadas se separan', superpuestas(cajas, off) === 0,
    `desplazamientos: ${off.map((o) => Math.round(o)).join(', ')} px`)
  check('la de más arriba no se mueve', off[0] === 0)
}

// --- Ya separadas: no se toca nada ------------------------------------
{
  const cajas = [caja(100), caja(300), caja(500)]
  const off = resolverColisiones(cajas, MARGEN)
  check('si ya entran, no las mueve', off.every((o) => o === 0))
}

// --- Solapamiento parcial --------------------------------------------
{
  const cajas = [caja(100, 60), caja(140, 60)]
  const off = resolverColisiones(cajas, MARGEN)
  // La segunda arranca en 110 y la primera termina en 130: se pisan 20 px,
  // más 14 de margen = 34 de empuje.
  check('empuja sólo lo necesario', Math.abs(off[1] - 34) < 0.01, `${off[1]} px`)
  check('respeta el margen mínimo', superpuestas(cajas, off) === 0)
}

// --- Las atenuadas no ocupan lugar -----------------------------------
{
  const cajas = [caja(200, 60, false), caja(205, 60, true)]
  const off = resolverColisiones(cajas, MARGEN)
  check(
    'una etiqueta apagada no corre a las visibles',
    off[1] === 0,
    'la que no se ve no reserva espacio',
  )
}

// --- Sólo baja, nunca sube -------------------------------------------
{
  const cajas = [caja(300), caja(305)]
  const off = resolverColisiones(cajas, MARGEN)
  check('nunca desplaza hacia arriba', off.every((o) => o >= 0),
    'si empujara en ambos sentidos, el grupo se movería entero al cruzarse')
}

// --- Casos límite -----------------------------------------------------
{
  check('sin etiquetas no rompe', resolverColisiones([], MARGEN).length === 0)
  const una = resolverColisiones([caja(100)], MARGEN)
  check('con una sola no la mueve', una[0] === 0)
  const ninguna = resolverColisiones([caja(100, 60, false)], MARGEN)
  check('con todas apagadas devuelve cero', ninguna[0] === 0)
}

// --- Alturas distintas (el texto puede ocupar una o dos líneas) -------
{
  const cajas = [caja(200, 44), caja(206, 78), caja(210, 60)]
  const off = resolverColisiones(cajas, MARGEN)
  check('funciona con alturas distintas', superpuestas(cajas, off) === 0,
    `desplazamientos: ${off.map((o) => Math.round(o)).join(', ')} px`)
}

// --- El eje horizontal, que antes se ignoraba -------------------------
{
  // Misma altura, extremos opuestos de la pantalla. No se pisan: no hay
  // nada que mover. Antes se corrían entre sí, y como la cámara orbita el
  // orden vertical cambiaba todo el tiempo y los textos temblaban.
  const cajas = [caja(300, 60, true, 200), caja(300, 60, true, 1100)]
  const off = resolverColisiones(cajas, MARGEN)
  check('a la misma altura pero lejos, no las toca', off.every((o) => o === 0))
}

{
  // Se rozan de costado: ahí sí hay que separarlas.
  const cajas = [caja(300, 60, true, 400, 150), caja(320, 60, true, 480, 150)]
  const off = resolverColisiones(cajas, MARGEN)
  check('si se rozan de costado, sí las separa', superpuestas(cajas, off) === 0,
    `desplazamientos: ${off.map((o) => Math.round(o)).join(', ')} px`)
}

{
  // Justo al borde: los rectángulos se tocan pero no se solapan.
  const cajas = [caja(300, 60, true, 400, 150), caja(300, 60, true, 550, 150)]
  const off = resolverColisiones(cajas, MARGEN)
  check('pegadas de costado sin solaparse, no las mueve', off.every((o) => o === 0))
}

{
  // Cadena: A pisa a B, y al bajar B queda pisando a C. Un solo pase no
  // alcanza; hace falta el punto fijo.
  const cajas = [caja(300, 60), caja(310, 60), caja(380, 60)]
  const off = resolverColisiones(cajas, MARGEN)
  check('una cadena de empujes se resuelve entera', superpuestas(cajas, off) === 0,
    `desplazamientos: ${off.map((o) => Math.round(o)).join(', ')} px`)
}

{
  // Cinco encimadas: no puede quedar ninguna sin lugar ni entrar en bucle.
  const cajas = Array.from({ length: 5 }, (_, i) => caja(300 + i * 4))
  const off = resolverColisiones(cajas, MARGEN)
  check('cinco encimadas se ordenan sin trabarse', superpuestas(cajas, off) === 0,
    `desplazamientos: ${off.map((o) => Math.round(o)).join(', ')} px`)
}

// --- Toda hoja de estilo tiene que estar importada --------------------
{
  /*
   * Un .css que nadie importa no falla: simplemente no se aplica, y el
   * componente sale sin estilo. Pasó de verdad — la etiqueta del reclamo
   * que cae se escribió en un archivo huérfano y en la pantalla salió
   * como texto suelto, sin card, sin que nada avisara.
   */
  const hojas: string[] = []
  const fuentes: string[] = []

  const recorrer = (dir: string) => {
    for (const nombre of readdirSync(dir)) {
      if (nombre === 'node_modules' || nombre.startsWith('.')) continue
      const ruta = join(dir, nombre)
      if (statSync(ruta).isDirectory()) recorrer(ruta)
      else if (nombre.endsWith('.css')) hojas.push(ruta)
      else if (/\.tsx?$/.test(nombre)) fuentes.push(readFileSync(ruta, 'utf8'))
    }
  }
  recorrer('src')

  const codigo = fuentes.join('\n')
  const huerfanas = hojas.filter((h) => !codigo.includes(basename(h)))

  check(
    'ninguna hoja de estilo quedó sin importar',
    huerfanas.length === 0,
    huerfanas.length ? huerfanas.join(', ') : `${hojas.length} revisadas`,
  )
}

// --- El modo claro no puede quedar a medias ---------------------------
{
  /*
   * Cada token de color definido en :root tiene que tener su valor en
   * [data-tema='claro'], salvo los hex de marca —que son identidad y se
   * comparten a propósito— y los que sólo referencian a otro token.
   *
   * Sin esto, agregar un token y olvidarse del claro no falla: queda un
   * panel oscuro sobre fondo blanco y nadie se entera hasta verlo.
   */
  const css = readFileSync('src/styles/global.css', 'utf8')

  const bloque = (selector: string) => {
    const desde = css.indexOf(selector)
    if (desde < 0) return ''
    const abre = css.indexOf('{', desde)
    const cierra = css.indexOf('\n}', abre)
    return css.slice(abre, cierra)
  }

  const tokensDe = (texto: string) =>
    [...texto.matchAll(/^\s+(--[a-z0-9-]+):\s*([^;]+);/gm)].map((m) => ({
      nombre: m[1],
      valor: m[2].trim(),
    }))

  const oscuros = tokensDe(bloque(':root {'))
  const claros = new Set(tokensDe(bloque(":root[data-tema='claro']")).map((t) => t.nombre))

  const esColor = (v: string) => /^#|^rgba?\(|^color-mix|^hsl/.test(v)
  const deMarca = (n: string) => n.startsWith('--smt-')
  const alias = (v: string) => v.startsWith('var(')

  const faltantes = oscuros
    .filter((t) => esColor(t.valor) && !deMarca(t.nombre) && !alias(t.valor))
    .filter((t) => !claros.has(t.nombre))
    .map((t) => t.nombre)

  check(
    'el modo claro redefine todos los colores del oscuro',
    faltantes.length === 0,
    faltantes.length ? `faltan: ${faltantes.join(', ')}` : `${claros.size} tokens redefinidos`,
  )
}

// ---------------------------------------------------------------------
// Acomodo contra los paneles fijos del overlay
// ---------------------------------------------------------------------
{
  console.log('\nACOMODO CONTRA LOS PANELES FIJOS')

  const VIEWPORT = { ancho: 1920, alto: 1080 }

  /** Los paneles reales de la pantalla del stand, a escala 1920x1080. */
  const PANELES: Zona[] = [
    { izq: 0, der: 300, arriba: 0, abajo: 60 }, // marca SMT
    { izq: 30, der: 640, arriba: 180, abajo: 560 }, // título + contadores
    { izq: 1460, der: 1900, arriba: 350, abajo: 700 }, // participación por área
    { izq: 1460, der: 1900, arriba: 720, abajo: 1000 }, // últimas ideas
  ]

  const rect = (c: CajaEtiqueta, a: { dx: number; dy: number }): Zona => ({
    izq: c.x + a.dx - c.ancho / 2,
    der: c.x + a.dx + c.ancho / 2,
    arriba: c.y + a.dy - c.alto / 2,
    abajo: c.y + a.dy + c.alto / 2,
  })

  const chocan = (a: Zona, b: Zona) =>
    a.izq < b.der && b.izq < a.der && a.arriba < b.abajo && b.arriba < a.abajo

  const tapaPanel = (r: Zona) => PANELES.some((z) => chocan(r, z))

  // -- Encima del bloque del título --
  {
    const cajas: CajaEtiqueta[] = [{ x: 300, ancho: 220, y: 300, alto: 70, visible: true }]
    const r = acomodar(cajas, PANELES, VIEWPORT, MARGEN)
    const caja = rect(cajas[0], r[0])
    check(
      'sale del bloque del título',
      !tapaPanel(caja) || r[0].oculta,
      `dx ${r[0].dx.toFixed(0)}, dy ${r[0].dy.toFixed(0)}, oculta ${r[0].oculta}`,
    )
    check(
      'se aparta de verdad, por donde sea',
      Math.abs(r[0].dx) + Math.abs(r[0].dy) > 0,
      'la direccion la elige el algoritmo: lo que importa es que no tape',
    )
  }

  // -- Encima del panel de áreas, a la derecha --
  {
    const cajas: CajaEtiqueta[] = [{ x: 1600, ancho: 220, y: 500, alto: 70, visible: true }]
    const r = acomodar(cajas, PANELES, VIEWPORT, MARGEN)
    check('sale del panel de áreas', !tapaPanel(rect(cajas[0], r[0])) || r[0].oculta)
    /*
     * No se le exige una dirección. La primera versión de esta prueba pedía
     * que saliera por la izquierda, y el algoritmo la sacaba por arriba, que
     * era un camino más corto y perfectamente válido: la prueba estaba
     * describiendo una implementación en vez de un requisito.
     */
    const q = rect(cajas[0], r[0])
    check(
      'al escapar no se va del cuadro',
      q.izq >= 0 && q.der <= VIEWPORT.ancho && q.arriba >= 0 && q.abajo <= VIEWPORT.alto,
      `dx ${r[0].dx.toFixed(0)}, dy ${r[0].dy.toFixed(0)}`,
    )
  }

  // -- Cuatro contra los bordes --
  {
    const cajas: CajaEtiqueta[] = [
      { x: 40, ancho: 220, y: 100, alto: 70, visible: true },
      { x: 1890, ancho: 220, y: 900, alto: 70, visible: true },
      { x: 960, ancho: 220, y: 20, alto: 70, visible: true },
      { x: 960, ancho: 220, y: 1060, alto: 70, visible: true },
    ]
    const r = acomodar(cajas, PANELES, VIEWPORT, MARGEN)
    // Sólo importan las que se van a ver: una apagada no molesta a nadie.
    const fuera = cajas.filter((c, i) => {
      if (r[i].oculta) return false
      const q = rect(c, r[i])
      return q.izq < 0 || q.der > VIEWPORT.ancho || q.arriba < 0 || q.abajo > VIEWPORT.alto
    }).length
    check('ninguna queda fuera del cuadro', fuera === 0, `${fuera} fuera`)
  }

  // -- Tres juntas en zona libre --
  {
    const cajas: CajaEtiqueta[] = [
      { x: 960, ancho: 220, y: 300, alto: 70, visible: true },
      { x: 980, ancho: 220, y: 320, alto: 70, visible: true },
      { x: 940, ancho: 220, y: 340, alto: 70, visible: true },
    ]
    const r = acomodar(cajas, PANELES, VIEWPORT, MARGEN)
    let choques = 0
    for (let i = 0; i < cajas.length; i++) {
      for (let j = i + 1; j < cajas.length; j++) {
        if (chocan(rect(cajas[i], r[i]), rect(cajas[j], r[j]))) choques++
      }
    }
    check('tres juntas no se pisan entre sí', choques === 0, `${choques} pares`)
  }

  // -- Dos obstáculos encadenados: el empuje tiene que sumarlos --
  {
    /*
     * El caso que se escapó la primera vez. Con una sola etiqueta ya
     * colocada el empuje salía bien; con dos, la segunda comparación se
     * hacía contra la posición vieja y la etiqueta quedaba corta,
     * superponiéndose igual. En pantalla eran dos ideas ilegibles.
     */
    const cajas: CajaEtiqueta[] = [
      { x: 900, ancho: 220, y: 200, alto: 70, visible: true },
      { x: 900, ancho: 220, y: 210, alto: 70, visible: true },
      { x: 900, ancho: 220, y: 220, alto: 70, visible: true },
      { x: 900, ancho: 220, y: 230, alto: 70, visible: true },
    ]
    const r = acomodar(cajas, PANELES, VIEWPORT, MARGEN)
    let choques = 0
    for (let i = 0; i < cajas.length; i++) {
      for (let j = i + 1; j < cajas.length; j++) {
        if (r[i].oculta || r[j].oculta) continue
        if (chocan(rect(cajas[i], r[i]), rect(cajas[j], r[j]))) choques++
      }
    }
    check(
      'cuatro apiladas se separan todas',
      choques === 0,
      `${choques} pares, dy: ${r.map((a) => Math.round(a.dy)).join(', ')}`,
    )
  }

  // -- Ya está en lugar libre --
  {
    const cajas: CajaEtiqueta[] = [{ x: 960, ancho: 220, y: 250, alto: 70, visible: true }]
    const r = acomodar(cajas, PANELES, VIEWPORT, MARGEN)
    check(
      'si ya está en lugar libre no la mueve',
      r[0].dx === 0 && r[0].dy === 0,
      'mover algo que no molesta es movimiento sin motivo',
    )
  }

  // -- Barrido: ninguna posición de la pantalla debe terminar tapando --
  {
    /*
     * Cada posición se prueba SOLA.
     *
     * La primera versión metía las 200 en una misma llamada y daba 145
     * apagadas, que parecía un desastre del algoritmo y era un disparate del
     * test: 200 tarjetas de 220x70 son 3.080.000 px² de etiquetas sobre una
     * pantalla de 2.073.600. No entran, y apagarlas era la respuesta
     * correcta. Lo que se quiere saber es otra cosa: desde cualquier punto
     * de la pantalla, ¿encuentra lugar una etiqueta?
     */
    const cajas: CajaEtiqueta[] = []
    const resultados: Array<{ dx: number; dy: number; oculta: boolean }> = []
    for (let x = 120; x < VIEWPORT.ancho; x += 90) {
      for (let y = 80; y < VIEWPORT.alto; y += 110) {
        const c: CajaEtiqueta = { x, ancho: 220, y, alto: 70, visible: true }
        cajas.push(c)
        resultados.push(acomodar([c], PANELES, VIEWPORT, MARGEN)[0])
      }
    }
    const r = resultados
    const tapando = cajas.filter((c, i) => !r[i].oculta && tapaPanel(rect(c, r[i]))).length
    const ocultas = r.filter((a) => a.oculta).length
    check(
      'ninguna visible termina tapando un panel',
      tapando === 0,
      `${cajas.length} posiciones probadas, ${tapando} tapando, ${ocultas} apagadas`,
    )

    /*
     * El desplazamiento tiene que ser acotado.
     *
     * Es la prueba que faltaba cuando el algoritmo empujaba en un ciclo:
     * en pantalla llegó a poner translate -1240px en una ventana de 922 px
     * de ancho, y la etiqueta simplemente no se veía. Ninguna verificación
     * lo cazó porque todas miraban superposiciones, no distancias.
     */
    const salto = Math.max(...r.map((a) => Math.hypot(a.dx, a.dy)))
    check(
      'ninguna se desplaza más que el cuadro',
      salto <= Math.hypot(VIEWPORT.ancho, VIEWPORT.alto),
      `mayor desplazamiento: ${Math.round(salto)} px`,
    )

    // Y la mayoría tiene que encontrar lugar: apagar es la última opción.
    check(
      'la mayoría encuentra lugar',
      ocultas < cajas.length * 0.35,
      `${ocultas} de ${cajas.length} apagadas`,
    )
  }
}

console.log(
  fallos === 0
    ? '\nLas etiquetas no se pisan.\n'
    : `\n${fallos} verificación(es) fallaron.\n`,
)

process.exit(fallos === 0 ? 0 : 1)
