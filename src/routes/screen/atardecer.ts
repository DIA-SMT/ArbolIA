import * as THREE from 'three'
import { CIELO, type Tema } from './temaEscena'

/**
 * El atardecer: convertir el corte seco de Ctrl+L en una caída de la luz.
 *
 * QUÉ TRANSICIONA Y QUÉ NO, y por qué.
 *
 * Los dos temas de esta instalación NO son dos puntos de un mismo continuo:
 * son dos modelos de dibujo. En oscuro todo lo vivo es luz ADITIVA —se suma
 * al fondo— y en claro es tinta con mezcla NORMAL —tapa el fondo—. Entre
 * AdditiveBlending y NormalBlending no existe el 50 %.
 *
 * Así que transiciona el FONDO, que sí es continuo: el cielo, la niebla y
 * la tierra. El árbol, los bichos y el overlay cruzan de un lado al otro
 * una sola vez, y ese cruce se pone en el punto más oscuro del recorrido,
 * que es donde menos se nota: con el cielo casi negro, un material aditivo
 * y uno de tinta pintan casi lo mismo.
 *
 * LA FASE VIVE EN UN REF, NO EN ESTADO DE REACT. Se escribe sesenta veces
 * por segundo, y llevar eso al estado de React re-renderizaría el árbol
 * entero en cada cuadro. Sólo el CRUCE —una vez por transición— toca el
 * estado.
 *
 * Y LA FASE NUNCA ES DEPENDENCIA DE UN useMemo. Verificado en el fuente de
 * three: WebGLShaderCache.materialCache es un Map FUERTE indexado por
 * material, y sólo lo limpia material.dispose(). Un useMemo([fase])
 * fabricaría sesenta materiales por segundo y los dejaría retenidos todos.
 * Los materiales se crean una vez; el color y la opacidad se escriben.
 */

/** Cuánto dura el atardecer entero, en segundos. */
export const DURACION_S = 18

/**
 * La fase como número: 0 es el día, 1 es la noche.
 *
 * El tema claro ES el día y el oscuro ES la noche. Nombrarlo así y no
 * "progreso" evita el error de leer la fase al revés en algún lado.
 */
export function faseDe(tema: Tema): number {
  return tema === 'oscuro' ? 1 : 0
}

/** En qué tema cae una fase. El cruce ocurre exactamente en la mitad. */
export function temaDe(fase: number): Tema {
  return fase >= 0.5 ? 'oscuro' : 'claro'
}

/**
 * El cielo sin teñir en el instante actual del atardecer.
 *
 * Existe porque DOS cosas escriben scene.background y se pisarían: el
 * director del atardecer, que lo mueve del día a la noche, y Sol, que lo
 * tiñe mientras el astro está alto. Con esto el director escribe acá su
 * color base, y Sol lo lee en vez de leer la tabla del tema — así el paso
 * del astro sigue funcionando exactamente igual en medio de un atardecer.
 *
 * Objetos vivos que se mutan, nunca se reemplazan: los lee un useFrame.
 */
export const cieloAhora = {
  fondo: new THREE.Color(CIELO.oscuro.fondo),
  niebla: new THREE.Color(CIELO.oscuro.niebla),
  cerca: CIELO.oscuro.cerca,
  lejos: CIELO.oscuro.lejos,
}

const diaFondo = new THREE.Color(CIELO.claro.fondo)
const nocheFondo = new THREE.Color(CIELO.oscuro.fondo)
const diaNiebla = new THREE.Color(CIELO.claro.niebla)
const nocheNiebla = new THREE.Color(CIELO.oscuro.niebla)

/** Recalcula el cielo base para una fase. Sin asignar objetos nuevos. */
export function escribirCieloBase(fase: number): void {
  cieloAhora.fondo.lerpColors(diaFondo, nocheFondo, fase)
  cieloAhora.niebla.lerpColors(diaNiebla, nocheNiebla, fase)
  cieloAhora.cerca = THREE.MathUtils.lerp(CIELO.claro.cerca, CIELO.oscuro.cerca, fase)
  cieloAhora.lejos = THREE.MathUtils.lerp(CIELO.claro.lejos, CIELO.oscuro.lejos, fase)
}

/**
 * Curva del atardecer.
 *
 * No es lineal a propósito. Una caída pareja de la luz se lee como un
 * regulador de intensidad; un atardecer de verdad se demora arriba, se
 * desploma en el medio y se demora abajo. El suavizado en los dos extremos
 * hace además que el arranque y el final no tengan un quiebre de velocidad,
 * que es lo que delataría que hubo un evento y no un rato del día.
 */
export function curva(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

/**
 * El teñido del astro, publicado por Sol y compuesto por el director.
 *
 * POR QUÉ SOL YA NO ESCRIBE scene.background. Con el atardecer hay DOS
 * cosas que quieren mover el cielo: el director, que lo lleva del día a la
 * noche, y Sol, que lo tiñe mientras el astro está alto. Escribiendo los
 * dos, gana el que corra último en el cuadro — y como Sol vive adentro de
 * GrowthRig corre después, así que el director le borraba el tinte o al
 * revés, según dónde estuviera cada uno en el JSX. Un orden de JSX no es
 * lugar donde apoyar el cielo de una instalación.
 *
 * Ahora Sol PUBLICA acá hacia qué color tira y con cuánta fuerza, y el
 * director compone: fondo del atardecer, teñido por el astro. Un solo
 * escritor de scene.background y scene.fog, y el resultado no depende del
 * orden en que corran.
 *
 * brillo 0 = no hay astro en el cielo y el tinte no se aplica.
 */
export const astro = {
  brillo: 0,
  fondo: new THREE.Color(CIELO.oscuro.fondo),
  niebla: new THREE.Color(CIELO.oscuro.niebla),
}
