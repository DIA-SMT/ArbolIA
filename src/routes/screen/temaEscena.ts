import * as THREE from 'three'

/**
 * Cómo se comporta la materia luminosa de la escena en cada tema.
 *
 * Sobre fondo oscuro todo lo vivo del árbol es LUZ: se suma al fondo. Sobre
 * un fondo casi blanco esa suma no existe físicamente —sumar luz sobre
 * blanco da blanco— así que lo mismo tiene que pasar a ser TINTA: mezcla
 * normal, color oscuro, opacidad alta.
 *
 * Los tres animales y el astro ya resolvían esto cada uno por su cuenta,
 * con su propia tabla APARIENCIA. Este módulo es ese mismo criterio en un
 * solo lugar, para todo lo demás que también era luz y en claro
 * desaparecía: la atmósfera, la partícula que viaja, el fruto que cae, la
 * ráfaga de los hitos y el follaje.
 *
 * Por qué importaba: medido en la instalación corriendo, en tema claro
 * TODO lo aditivo era literalmente invisible. Eso incluye el momento que
 * la instalación existe para producir —la partícula de una vecina subiendo
 * por el tronco hasta brotar en hoja— y la crítica cayendo a las raíces.
 * No era un problema de contraste: no se dibujaban.
 */

export type Tema = 'claro' | 'oscuro'

export function blendingDe(tema: Tema): THREE.Blending {
  return tema === 'claro' ? THREE.NormalBlending : THREE.AdditiveBlending
}

/**
 * Traduce un color pensado para brillar sobre negro a su equivalente en
 * tinta sobre blanco.
 *
 * Conserva el TONO, que es lo que significa —cada área de la ciudad tiene
 * el suyo, y son ocho hues verificados por distinguibilidad entre sí— y
 * cambia el valor y la saturación, que es donde vive la legibilidad.
 *
 * Sin esto, sobre el fondo #f7fafd el amarillo de Tecnología (#facc15,
 * L 0.53) y sobre todo el rosa de Cultura (#f9a8d4, L 0.82) son
 * prácticamente el fondo. El techo de luminosidad es lo que hace el
 * trabajo; la saturación sube apenas para compensar que un color oscuro
 * se percibe más lavado que el mismo tono claro.
 *
 * @param techoL Luminosidad máxima permitida (HSL, 0..1).
 */
export function tinta(color: THREE.Color | string, techoL = 0.42): THREE.Color {
  const c = color instanceof THREE.Color ? color.clone() : new THREE.Color(color)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  return c.setHSL(hsl.h, Math.min(1, hsl.s * 1.12 + 0.06), Math.min(hsl.l, techoL))
}

/** El mismo color en el tema activo: luz tal cual en oscuro, tinta en claro. */
export function segunTema(
  color: THREE.Color | string,
  tema: Tema,
  techoL = 0.42,
): THREE.Color {
  if (tema === 'claro') return tinta(color, techoL)
  return color instanceof THREE.Color ? color.clone() : new THREE.Color(color)
}

/**
 * Escribe sobre un color ya existente, sin crear objetos.
 *
 * Los bucles de cuadro no pueden asignar colores nuevos: Journey y
 * FallingFruit recolorean sus materiales en cada idea que llega.
 */
export function aplicarTemaColor(
  destino: THREE.Color,
  origen: THREE.Color | string,
  tema: Tema,
  techoL = 0.42,
): THREE.Color {
  destino.set(origen as THREE.ColorRepresentation)
  if (tema === 'oscuro') return destino
  const hsl = { h: 0, s: 0, l: 0 }
  destino.getHSL(hsl)
  return destino.setHSL(hsl.h, Math.min(1, hsl.s * 1.12 + 0.06), Math.min(hsl.l, techoL))
}

/**
 * Hacia dónde tira el "blanco" de cada tema.
 *
 * Varias cosas de la escena mezclan su color hacia el blanco para marcar
 * incandescencia: la cabeza de la partícula, la hoja recién brotada. Sobre
 * papel eso las borra, así que ahí el extremo del gesto no es el blanco
 * sino la tinta institucional.
 */
/**
 * El cielo de cada tema: fondo de la escena y niebla.
 *
 * Vive acá, y no escrito a mano en el JSX de TreeScene, porque hay DOS
 * lugares que necesitan saberlo y uno de ellos lo estaba adivinando.
 *
 * Sol.tsx tiñe el cielo mientras el astro está alto y después lo devuelve a
 * su color. Para poder devolverlo, clonaba scene.background al ARRANCAR el
 * paso. Eso funciona hasta que el operador toca Ctrl+L a mitad de un paso:
 * a partir de ahí Sol sostiene el cielo del tema viejo, y al terminar el
 * evento lo "restaura" —al tema viejo— encima del nuevo. El fondo quedaba
 * equivocado hasta el próximo paso del astro, que puede tardar minutos.
 *
 * Con la tabla, Sol no captura nada: siempre sabe cuál es el cielo sin
 * teñir del tema que está corriendo AHORA.
 *
 * En claro la niebla se acerca a propósito: sobre fondo oscuro difumina la
 * profundidad, sobre fondo claro tiene que dibujar el contorno o las ramas
 * del fondo se pierden contra el blanco.
 */
export const CIELO: Record<Tema, { fondo: string; niebla: string; cerca: number; lejos: number }> = {
  oscuro: { fondo: '#050a12', niebla: '#071220', cerca: 9.5, lejos: 21 },
  claro: { fondo: '#f7fafd', niebla: '#e9f1f9', cerca: 8.5, lejos: 19 },
}

export const NUCLEO_TEMA: Record<Tema, THREE.Color> = {
  // Constantes de módulo y no una función que devuelve un color nuevo:
  // esto se usa dentro de bucles de cuadro, donde crear un objeto por
  // frame es exactamente lo que no se puede hacer. Se leen con lerp(),
  // que no las modifica.
  oscuro: new THREE.Color('#ffffff'),
  claro: new THREE.Color('#10233d'),
}
