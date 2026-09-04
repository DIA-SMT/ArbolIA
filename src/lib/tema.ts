import { useCallback, useEffect, useState } from 'react'

/**
 * Fondo claro u oscuro, en las tres pantallas.
 *
 * No son dos diseños: es la misma paleta institucional en sus dos
 * soportes. El manual del municipio está definido para papel —tinta
 * #10233d, texto #33414f, líneas #e3e8ef sobre blanco— y el modo oscuro
 * de esta instalación es la traducción de eso a un LED en un pabellón sin
 * luz. El modo claro, en realidad, es el original.
 */

export type Tema = 'claro' | 'oscuro'

const CLAVE = 'arbolia-tema'

function guardado(): Tema | null {
  try {
    const v = localStorage.getItem(CLAVE)
    return v === 'claro' || v === 'oscuro' ? v : null
  } catch {
    // Navegación privada, o almacenamiento bloqueado. No es motivo para
    // que la pantalla del stand no arranque.
    return null
  }
}

function delSistema(): Tema {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'claro' : 'oscuro'
}

export function aplicarTema(tema: Tema): void {
  document.documentElement.dataset.tema = tema
  // Le dice al navegador de qué color pintar los controles nativos y la
  // barra de scroll. Sin esto, en claro los selects del panel quedan
  // oscuros contra un fondo blanco.
  document.documentElement.style.colorScheme = tema === 'claro' ? 'light' : 'dark'
}

/**
 * Ruta de la pantalla del stand: la única que arranca en oscuro por
 * decisión propia en vez de seguir al sistema. Ver useTema() abajo.
 */
const RUTA_PANTALLA = '/'

/**
 * Qué tema corresponde ANTES de que monte ninguna ruta.
 *
 * Existe para el arranque. Las rutas se cargan con lazy() y mientras tanto
 * se ve <Boot />, que se dibuja antes de que ningún useTema haya corrido:
 * hasta ese momento no había data-tema en el html, así que la pantalla de
 * carga salía siempre oscura y saltaba a blanco al montar la app. En el
 * celular del vecino, donde el bundle es chico y la carga dura poco, ese
 * flash negro era lo primero que veía.
 *
 * Lo llama main.tsx antes de render(). La regla es la misma que aplica
 * useTema después, así que el valor no cambia al montar la ruta.
 */
export function temaInicial(ruta: string = window.location.pathname): Tema {
  return guardado() ?? (ruta === RUTA_PANTALLA ? 'oscuro' : delSistema())
}

/**
 * @param porDefecto Qué usar cuando nadie eligió todavía.
 *
 * La pantalla del stand pasa 'oscuro' a propósito, en vez de seguir al
 * sistema: el árbol está hecho de resplandor aditivo sobre fondo profundo
 * y en claro pierde casi todo el efecto. Si la PC del stand tuviera el
 * sistema en claro, la instalación abriría con el peor de sus dos
 * aspectos sin que nadie lo haya decidido. El celular y el panel sí
 * siguen al sistema, que es lo que la persona espera.
 */
export function useTema(
  porDefecto?: Tema,
  /**
   * Si estampar el tema en el documento apenas cambia.
   *
   * La pantalla del stand pasa false porque su cambio de tema no es
   * instantáneo: es un atardecer de varios segundos, y el overlay tiene que
   * cruzar recién en el punto más oscuro del recorrido, no al principio.
   * Ahí lo estampa ella cuando corresponde, llamando a aplicarTema.
   *
   * El celular y el panel no tienen atardecer y lo dejan en true, que es el
   * comportamiento de siempre.
   */
  estamparEnElDocumento = true,
): [Tema, () => void] {
  const [tema, setTema] = useState<Tema>(() => guardado() ?? porDefecto ?? delSistema())

  useEffect(() => {
    if (estamparEnElDocumento) aplicarTema(tema)
  }, [tema, estamparEnElDocumento])

  // Si nadie eligió, seguir al sistema cuando el sistema cambie.
  useEffect(() => {
    if (guardado()) return
    const mq = window.matchMedia?.('(prefers-color-scheme: light)')
    if (!mq || porDefecto) return

    const alCambiar = () => setTema(delSistema())
    mq.addEventListener('change', alCambiar)
    return () => mq.removeEventListener('change', alCambiar)
  }, [porDefecto])

  const alternar = useCallback(() => {
    setTema((actual) => {
      const siguiente: Tema = actual === 'oscuro' ? 'claro' : 'oscuro'
      try {
        localStorage.setItem(CLAVE, siguiente)
      } catch {
        // Si no se puede guardar, al menos vale para esta sesión.
      }
      return siguiente
    })
  }, [])

  return [tema, alternar]
}
