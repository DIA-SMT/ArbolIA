import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import TreeScene from './TreeScene'
import DevBridge from './DevBridge'
import { DiagnosticsHud, type DiagInfo } from './Diagnostics'
import ScreenOverlay from './overlay/ScreenOverlay'
import { useLiveTree } from '../../hooks/useLiveTree'
import { getGrowthProfile } from '../../lib/growth'
import { useTema } from '../../lib/tema'

/** Cuántas ideas recientes se listan en la columna derecha. */
const RECENT_COUNT = 5

/**
 * Interruptores por URL, pensados para el día del armado en el stand:
 *   ?fx=off   apaga el postprocesado (bloom + viñeta)
 *   ?diag     muestra el panel de diagnóstico (tecla D lo oculta)
 */
function readFlags() {
  const params = new URLSearchParams(window.location.search)
  const pedida = params.get('calidad')
  return {
    postprocessing: params.get('fx') !== 'off',
    diagnostics: params.has('diag'),
    /*
     * ?calidad=alta|media fija la calidad y apaga el guardián.
     *
     * El guardián baja la calidad solo si caen los cuadros, que es lo que
     * se quiere sin nadie mirando. Pero un tirón de un segundo —el
     * navegador indexando, un pico de red— la deja degradada el resto de
     * la jornada, y nadie en el stand va a saber por qué la pantalla se
     * ve peor que en la prueba. Con esto el operador la clava.
     */
    calidadFijada: (pedida === 'alta' || pedida === 'media' ? pedida : null) as 'alta' | 'media' | null,
  }
}

export default function ScreenRoute() {
  const tree = useLiveTree()
  const flags = useMemo(readFlags, [])
  const [quality, setQuality] = useState<'alta' | 'media'>(flags.calidadFijada ?? 'alta')
  const [diag, setDiag] = useState<DiagInfo | null>(null)
  // Las etapas dependen de la meta vigente: si el equipo la cambia durante
  // la expo, los tramos de crecimiento se recalculan solos.
  /*
   * Las críticas extienden las raíces.
   *
   * El perfil base sale del total de ideas, así que las raíces ya crecen
   * con la participación. Encima de eso, cada crítica agrega alcance: es
   * literalmente lo que la metáfora promete, y sin este término la caída
   * sería un lindo efecto que no deja nada.
   *
   * El tope existe porque uReveal recorta la geometría en 1: pasado ese
   * valor no hay más raíz que revelar y el término dejaría de leerse.
   * Con 22 críticas se alcanza el máximo, suficiente para empujar la base
   * más allá de 0.68 —donde empiezan las raíces secundarias— bastante
   * antes de que lo hiciera el crecimiento solo. O sea que el reclamo no
   * alarga la base: la RAMIFICA.
   */
  const growth = useMemo(
    () => {
      const base = getGrowthProfile(tree.stats.ideas, tree.goal)
      const empuje = Math.min(0.22, tree.stats.criticas * 0.01)
      return { ...base, rootReach: Math.min(1, base.rootReach + empuje) }
    },
    [tree.stats.ideas, tree.stats.criticas, tree.goal],
  )

  const recentIdeas = useMemo(
    () => [...tree.ideas].slice(-RECENT_COUNT).reverse(),
    [tree.ideas],
  )

  useEffect(() => {
    document.body.dataset.route = 'screen'
    return () => {
      delete document.body.dataset.route
    }
  }, [])

  /*
   * En la pantalla del stand el tema arranca en oscuro, no en el del
   * sistema. El árbol está hecho de resplandor aditivo sobre fondo
   * profundo: si la PC del predio tuviera el sistema en claro, la
   * instalación abriría con el peor de sus dos aspectos sin que nadie lo
   * haya decidido.
   */
  const [tema, alternarTema] = useTema('oscuro')

  useScreenShortcuts(tree.toggleSilencio, alternarTema)
  useWebGLWatchdog()

  return (
    <div className="screen">
      <Canvas
        // dpr acotado: en un LED de 1920×1080 con GPU integrada, renderizar a
        // 2x es tirar la mitad del framerate por algo que nadie ve de lejos.
        dpr={quality === 'alta' ? [1, 1.5] : 1}
        gl={{
          antialias: false,
          powerPreference: 'high-performance',
          alpha: false,
          stencil: false,
          depth: true,
          // Sólo en desarrollo: permite capturar el frame con toDataURL para
          // revisar el encuadre. En producción cuesta memoria y no se usa.
          preserveDrawingBuffer: import.meta.env.DEV,
        }}
        camera={{ fov: 42, near: 0.1, far: 60, position: [7, 2.6, 0] }}
        onCreated={({ gl }) => {
          gl.setClearColor('#050a12', 1)
        }}
      >
        <TreeScene
          propuestas={tree.propuestas}
          activeIdea={tree.activeIdea}
          criticaCayendo={tree.criticaCayendo}
          pulsoRaices={tree.pulsoRaices}
          tema={tema}
          growth={growth}
          celebration={tree.celebration}
          quality={quality}
          labelsVisible={!tree.textoSilenciado}
          postprocessing={flags.postprocessing}
          onDiagnostics={flags.diagnostics ? setDiag : undefined}
        />
        {!flags.calidadFijada && <PerformanceGuard onDowngrade={() => setQuality('media')} />}
        {import.meta.env.DEV && <DevBridge />}
      </Canvas>

      {flags.diagnostics && <DiagnosticsHud
          data={diag}
          fx={flags.postprocessing}
          calidad={quality}
          calidadFijada={flags.calidadFijada !== null}
        />}

      <ScreenOverlay
        stats={tree.stats}
        growth={growth}
        goal={tree.goal}
        celebration={tree.celebration}
        onDismissCelebration={tree.dismissCelebration}
        status={tree.status}
        // Con el silencio puesto no se pasa ni una idea: el bloque de
        // "Últimas ideas" mostraba el texto completo aunque las etiquetas
        // del árbol estuvieran ocultas, así que el botón de pánico dejaba
        // el texto ofensivo a la vista en la columna derecha.
        recentIdeas={tree.textoSilenciado ? [] : recentIdeas}
        silenciado={tree.textoSilenciado}
      />

      <style>{`
        .screen {
          position: fixed;
          inset: 0;
          background: #050a12;
        }
        .screen canvas {
          position: absolute;
          inset: 0;
        }
      `}</style>
    </div>
  )
}

/**
 * Baja la calidad si el equipo del stand no sostiene el framerate.
 *
 * No sabemos con qué PC se va a conectar la pantalla el día de la expo.
 * Mejor una instalación que se degrada sola que una que se arrastra a 12 fps
 * delante del público.
 */
function PerformanceGuard({ onDowngrade }: { onDowngrade: () => void }) {
  const framesRef = useRef(0)
  const startRef = useRef(performance.now())
  const doneRef = useRef(false)

  useEffect(() => {
    if (doneRef.current) return

    let raf = 0
    const tick = () => {
      framesRef.current += 1
      const elapsed = performance.now() - startRef.current

      // Medimos recién después de 4 s, cuando ya pasó el costo del arranque.
      if (elapsed > 4000) {
        const fps = (framesRef.current / elapsed) * 1000
        doneRef.current = true
        if (fps < 34) onDowngrade()
        return
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [onDowngrade])

  return null
}

/**
 * Atajos para el operador del stand. Sin menús ni botones a la vista:
 * la pantalla tiene que verse como una instalación, no como una aplicación.
 *
 *   Ctrl+H  silencia TODO el texto de ideas, y lo deja silenciado hasta que
 *           se vuelva a apretar. Es el botón de pánico: si se cuela algo
 *           indebido, saca el texto de la vista mientras se lo retira desde
 *           el panel, sin frenar la instalación ni dejar la pantalla negra.
 *   Ctrl+L  alterna fondo claro y oscuro
 *   F       pantalla completa
 */
function useScreenShortcuts(toggleSilencio: () => void, alternarTema: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'h') {
        e.preventDefault()
        toggleSilencio()
        return
      }

      // Ctrl+L: fondo claro / oscuro. Va por teclado y no por un botón
      // porque esto se proyecta: cualquier control visible es ruido sobre
      // la imagen que ve el público.
      if (e.ctrlKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        alternarTema()
        return
      }

      if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        if (document.fullscreenElement) {
          void document.exitFullscreen()
        } else {
          void document.documentElement.requestFullscreen().catch(() => undefined)
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleSilencio, alternarTema])
}

/**
 * Vigilancia del contexto WebGL.
 *
 * La pantalla va a correr diez horas por día durante toda la expo. Si el
 * driver pierde el contexto (pasa: suspensión, cambio de resolución, un
 * pico de memoria), el canvas queda en negro y no se recupera solo. Antes
 * que dejar un rectángulo negro delante del público, recargamos.
 */
function useWebGLWatchdog() {
  useEffect(() => {
    const canvas = document.querySelector('canvas')
    if (!canvas) return

    const onLost = (event: Event) => {
      event.preventDefault()
      console.warn('[arbolia] contexto WebGL perdido, recargando la pantalla')
      window.setTimeout(() => window.location.reload(), 1500)
    }

    canvas.addEventListener('webglcontextlost', onLost)
    return () => canvas.removeEventListener('webglcontextlost', onLost)
  }, [])
}
