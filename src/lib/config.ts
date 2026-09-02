const env = import.meta.env

export const SUPABASE_URL = (env.VITE_SUPABASE_URL ?? '').trim()
export const SUPABASE_ANON_KEY = (env.VITE_SUPABASE_ANON_KEY ?? '').trim()

export const IS_SUPABASE_CONFIGURED =
  SUPABASE_URL.startsWith('http') && SUPABASE_ANON_KEY.length > 20

/**
 * Modo demostración: SÓLO en desarrollo.
 *
 * Sirve para trabajar el 3D sin backend. Pero en producción sería un
 * desastre institucional: si faltara una variable de entorno en Vercel, la
 * app no fallaría — se llenaría de ideas fabricadas ("Ciclovías seguras que
 * conecten el centro con Yerba Buena") y las proyectaría en el LED del
 * municipio como si fueran de vecinos reales, con contadores inventados
 * incluidos. Y el celular le diría a la gente "tu idea ya es parte del
 * árbol" sin haber guardado nada.
 *
 * En producción sin credenciales la pantalla avisa y no simula nada.
 */
export const DEMO_MODE = !IS_SUPABASE_CONFIGURED && import.meta.env.DEV

/** Falta configuración y no estamos en desarrollo: hay que avisar, no fingir. */
export const MISCONFIGURED = !IS_SUPABASE_CONFIGURED && !import.meta.env.DEV

/** URL que se codifica en el QR de la pantalla principal. */
export const PUBLIC_URL = (env.VITE_PUBLIC_URL ?? window.location.origin).replace(/\/$/, '')

export const QR_TARGET = `${PUBLIC_URL}/idea`

/**
 * Meta de arranque.
 *
 * Es sólo el valor por defecto: la meta real vive en la tabla settings y se
 * edita desde el panel durante la expo. Ésta se usa mientras carga y como
 * respaldo si la base no responde, para que la barra de progreso nunca
 * quede sin referencia.
 */
export const GOAL_FALLBACK = Number(env.VITE_GOAL ?? 500) || 500

/** Hitos que disparan celebración, derivados de la meta vigente. */
export function milestonesFor(goal: number): number[] {
  return [Math.round(goal * 0.2), Math.round(goal * 0.5), goal]
}

/**
 * Qué hitos hay que festejar y cuáles sólo registrar.
 *
 * Está acá y no dentro del hook porque es la decisión que la pantalla no
 * puede equivocar: una celebración a pantalla completa que aparece sin
 * motivo, delante del público, se lee como que la instalación se rompió.
 *
 * EL CASO QUE LO ROMPÍA. La meta se puede cambiar en plena feria, y al
 * cambiarla cambian los hitos —son 20 %, 50 % y 100 % de la meta vigente—
 * mientras la lista de "ya celebrados" conserva los viejos. Con 400 ideas y
 * meta 500, los hitos son 100, 250 y 500, todos registrados; al pasar la
 * meta a 1500 pasan a ser 300, 750 y 1500, y ese 300 —que 400 ya supera—
 * nunca se registró. Bajar la meta es peor: dispara varios de una.
 *
 * Devuelve los hitos a REGISTRAR y, aparte, el único que corresponde
 * celebrar. Al cambiar la meta se registra todo en silencio, igual que hace
 * la carga inicial.
 */
export function hitosAlcanzados(
  goal: number,
  ideas: number,
  yaVistos: ReadonlySet<number>,
): number[] {
  return milestonesFor(goal).filter((hito) => ideas >= hito && !yaVistos.has(hito))
}

export const IDEA_MAX_LENGTH = 180
export const IDEA_MIN_LENGTH = 3
