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
import { resolverColisiones, type CajaEtiqueta } from '../src/routes/screen/labelLayout'

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
      else if (/.tsx?$/.test(nombre)) fuentes.push(readFileSync(ruta, 'utf8'))
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

console.log(
  fallos === 0
    ? '\nLas etiquetas no se pisan.\n'
    : `\n${fallos} verificación(es) fallaron.\n`,
)

process.exit(fallos === 0 ? 0 : 1)
