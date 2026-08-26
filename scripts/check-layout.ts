/**
 * Verificación de la resolución de colisiones entre etiquetas.
 *
 * Corre sin navegador. Comprueba lo que se veía mal en la pantalla: dos
 * ideas que caen en hojas cercanas terminaban con los textos encimados e
 * ilegibles.
 *
 *   npm run check:layout
 */
import { resolverColisiones, type CajaEtiqueta } from '../src/routes/screen/labelLayout'

const MARGEN = 14
let fallos = 0

function check(label: string, ok: boolean, detalle = '') {
  const marca = ok ? 'OK  ' : 'FALLA'
  if (!ok) fallos++
  console.log(`  ${marca}  ${label}${detalle ? ` — ${detalle}` : ''}`)
}

/** ¿Queda alguna superposición después de aplicar los desplazamientos? */
function superpuestas(cajas: CajaEtiqueta[], offsets: number[]): number {
  const finales = cajas
    .map((c, i) => ({
      arriba: c.y - c.alto / 2 + offsets[i],
      abajo: c.y + c.alto / 2 + offsets[i],
      visible: c.visible,
    }))
    .filter((c) => c.visible)
    .sort((a, b) => a.arriba - b.arriba)

  let choques = 0
  for (let i = 1; i < finales.length; i++) {
    if (finales[i].arriba < finales[i - 1].abajo) choques++
  }
  return choques
}

const caja = (y: number, alto = 60, visible = true): CajaEtiqueta => ({ y, alto, visible })

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

console.log(
  fallos === 0
    ? '\nLas etiquetas no se pisan.\n'
    : `\n${fallos} verificación(es) fallaron.\n`,
)

process.exit(fallos === 0 ? 0 : 1)
