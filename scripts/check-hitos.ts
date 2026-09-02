/**
 * Verificación de los hitos de celebración.
 *
 * EXISTE POR UNA PREGUNTA DEL EQUIPO: "si cambio la meta en medio de la
 * feria, no se rompe nada?".
 *
 * Se rompía. Los hitos son 20 %, 50 % y 100 % de la meta VIGENTE, y al
 * cambiar la meta cambian los hitos mientras la lista de "ya celebrados"
 * conserva los viejos. Con 400 ideas y meta 500 los hitos son 100, 250 y
 * 500, todos registrados; al pasar la meta a 1500 pasan a 300, 750 y 1500, y
 * ese 300 —que 400 ya supera— nunca se registró: la pantalla disparaba la
 * celebración a pantalla completa sin que nadie hubiera cruzado nada.
 *
 * Es el peor lugar para un error de estos: la celebración tapa el árbol
 * entero, delante del público, y se lee como que la instalación se rompió.
 *
 *   npm run check:hitos
 */
import { hitosAlcanzados, milestonesFor } from '../src/lib/config'

let fallos = 0
const check = (etiqueta: string, ok: boolean, detalle = '') => {
  if (!ok) fallos++
  console.log(`  ${ok ? 'OK  ' : 'FALLA'}  ${etiqueta}${detalle ? ` — ${detalle}` : ''}`)
}

console.log('\nQUÉ HITOS TIENE CADA META')

check('con meta 500 son 100, 250 y 500', milestonesFor(500).join() === '100,250,500')
check('con meta 1500 son 300, 750 y 1500', milestonesFor(1500).join() === '300,750,1500')
check(
  'una meta impar no genera decimales',
  milestonesFor(333).every((h) => Number.isInteger(h)),
  milestonesFor(333).join(', '),
)

console.log('\nEL CRUCE NORMAL SÍ SE FESTEJA')

{
  const vistos = new Set<number>([100])
  const nuevos = hitosAlcanzados(500, 250, vistos)
  check(
    'al llegar a la mitad de la meta aparece ese hito',
    nuevos.join() === '250',
    `devolvió [${nuevos.join(', ')}]`,
  )
}

{
  const vistos = new Set<number>([100, 250])
  check(
    'un hito ya festejado no vuelve',
    hitosAlcanzados(500, 300, vistos).length === 0,
  )
}

{
  const vistos = new Set<number>([100, 250])
  const nuevos = hitosAlcanzados(500, 500, vistos)
  check('llegar a la meta aparece', nuevos.join() === '500')
}

console.log('\nCAMBIAR LA META EN MEDIO DE LA FERIA')

/*
 * El escenario textual que preguntó el equipo: meta 500, se llena rápido, la
 * suben a 1500. La función tiene que DEVOLVER los hitos nuevos ya superados
 * —hay que registrarlos— y es el hook el que no los celebra. Acá se
 * comprueba que los devuelve, que es lo que permite registrarlos en
 * silencio; si devolviera lista vacía quedarían sin registrar y saltarían
 * más tarde.
 */
{
  const vistos = new Set<number>([100, 250]) // los de la meta 500
  const nuevos = hitosAlcanzados(1500, 400, vistos)
  check(
    'subir la meta expone el hito nuevo ya superado',
    nuevos.join() === '300',
    'con 400 ideas, el 20 % de 1500 es 300 y ya está pasado: hay que registrarlo sin festejar',
  )
}

{
  // Bajar la meta es el caso peor: varios hitos nuevos ya superados de una.
  const vistos = new Set<number>([300, 750]) // los de la meta 1500
  const nuevos = hitosAlcanzados(500, 400, vistos)
  check(
    'bajar la meta expone varios de una',
    nuevos.join() === '100,250',
    `devolvió [${nuevos.join(', ')}] — sin el arreglo, esto era una celebración por cada uno`,
  )
}

{
  // Y después del cambio, el próximo cruce real sí tiene que festejarse.
  const vistos = new Set<number>([100, 250, 300, 750])
  const nuevos = hitosAlcanzados(1500, 1500, vistos)
  check(
    'después de cambiar la meta, el cruce siguiente sigue apareciendo',
    nuevos.join() === '1500',
    'el arreglo silencia el cambio de meta, no las celebraciones futuras',
  )
}

console.log('\nBORDES')

check('sin ideas no hay hitos', hitosAlcanzados(500, 0, new Set()).length === 0)
check(
  'pasarse de la meta no agrega hitos inventados',
  hitosAlcanzados(500, 9000, new Set([100, 250, 500])).length === 0,
)
{
  const nuevos = hitosAlcanzados(500, 9000, new Set())
  check(
    'arrancar de cero con la feria avanzada devuelve los tres, para registrarlos',
    nuevos.join() === '100,250,500',
    'es lo que hace la carga inicial: los da por vistos sin festejar',
  )
}
check(
  'el orden es de menor a mayor, así que el último es el más alto',
  (() => {
    const n = hitosAlcanzados(500, 500, new Set())
    return n[n.length - 1] === 500
  })(),
  'el hook festeja el último: si entraran dos juntos, festejar el chico sería raro',
)

console.log(
  fallos === 0
    ? '\n  Cambiar la meta en plena feria no dispara celebraciones falsas.\n'
    : `\n  ${fallos} verificación(es) fallaron.\n`,
)

process.exit(fallos === 0 ? 0 : 1)
