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
 * @param porDefecto Qué usar cuando nadie eligió todavía.
 *
 * La pantalla del stand pasa 'oscuro' a propósito, en vez de seguir al
 * sistema: el árbol está hecho de resplandor aditivo sobre fondo profundo
 * y en claro pierde casi todo el efecto. Si la PC del stand tuviera el
 * sistema en claro, la instalación abriría con el peor de sus dos
 * aspectos sin que nadie lo haya decidido. El celular y el panel sí
 * siguen al sistema, que es lo que la persona espera.
 */
export function useTema(porDefecto?: Tema): [Tema, () => void] {
  const [tema, setTema] = useState<Tema>(() => guardado() ?? porDefecto ?? delSistema())

  useEffect(() => {
    aplicarTema(tema)
  }, [tema])

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
