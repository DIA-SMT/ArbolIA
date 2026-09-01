import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'

export interface DiagInfo {
  ancho: number
  alto: number
  dpr: number
  objetos: number
  llamadas: number
  triangulos: number
  texturas: number
  programas: number
  fps: number
  /**
   * El fps MÁS BAJO de la última media docena de muestras.
   *
   * El promedio esconde exactamente lo que arruina una instalación: un tirón
   * de medio segundo cada tanto. Con 60 de promedio y 22 de mínimo, en el LED
   * se ve un salto y el promedio dice que todo está bien.
   */
  fpsMinimo: number
  /** Hojas efectivamente dibujadas: es lo que más cuesta en esta escena. */
  hojas: number
}

/**
 * Sonda de la escena. Se activa con `?diag` en la URL.
 *
 * Sirve el día del armado en el stand: dice si el canvas está midiendo bien,
 * cuántos objetos hay realmente en la escena, cuántas llamadas de dibujo por
 * cuadro y a qué fps corre la PC que trajeron. Sin esto, un canvas en negro
 * puede ser cinco cosas distintas y no hay forma de saber cuál.
 */
export default function Diagnostics({ onSample }: { onSample: (d: DiagInfo) => void }) {
  const { gl, scene, size, viewport } = useThree()
  const frames = useRef(0)
  const last = useRef(performance.now())
  /** Ventana corta de muestras, para poder informar el mínimo. */
  const historia = useRef<number[]>([])

  useFrame(() => {
    frames.current += 1
    const now = performance.now()
    const elapsed = now - last.current
    if (elapsed < 500) return

    const fps = Math.round((frames.current / elapsed) * 1000)
    historia.current.push(fps)
    if (historia.current.length > 12) historia.current.shift()

    const info = gl.info
    onSample({
      ancho: size.width,
      alto: size.height,
      dpr: viewport.dpr,
      objetos: countObjects(scene),
      llamadas: info.render.calls,
      triangulos: info.render.triangles,
      texturas: info.memory.textures,
      programas: info.programs?.length ?? 0,
      fps,
      fpsMinimo: Math.min(...historia.current),
      hojas: contarHojas(scene),
    })

    frames.current = 0
    last.current = now
  })

  return null
}

/** Instancias de hoja dibujadas ahora mismo, sumando ambiente y ciudadanas. */
function contarHojas(scene: import('three').Object3D): number {
  let n = 0
  scene.traverse((o) => {
    const m = o as unknown as { isInstancedMesh?: boolean; count?: number }
    if (m.isInstancedMesh) n += m.count ?? 0
  })
  return n
}

function countObjects(scene: import('three').Object3D): number {
  let n = 0
  scene.traverse(() => {
    n += 1
  })
  return n
}

/** Panel de lectura, fuera del canvas. */
export function DiagnosticsHud({
  data,
  fx,
  calidad,
  calidadFijada,
}: {
  data: DiagInfo | null
  fx: boolean
  /** La calidad EFECTIVA. Puede no ser la de arranque: ver PerformanceGuard. */
  calidad: 'alta' | 'media'
  /** true si se fijó con ?calidad y el guardián está apagado. */
  calidadFijada: boolean
}) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'd') setVisible((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!visible) return null

  const rows: Array<[string, string]> = data
    ? [
        ['canvas', `${data.ancho} × ${data.alto} @ ${data.dpr.toFixed(2)}x`],
        ['fps', `${data.fps}  ·  mínimo ${data.fpsMinimo}`],
        /*
         * La calidad EFECTIVA, y si la bajó el guardián.
         *
         * Es el dato que faltaba para poder decidir en el stand. El guardián
         * degrada solo cuando caen los cuadros, así que una pantalla que se ve
         * peor de lo esperado puede ser simplemente que ya se defendió — y sin
         * verlo escrito no hay forma de distinguir eso de un problema.
         */
        [
          'calidad',
          calidadFijada
            ? `${calidad} (fijada con ?calidad)`
            : calidad === 'media'
              ? 'media — el guardián la bajó solo'
              : 'alta (el guardián no intervino)',
        ],
        ['hojas dibujadas', data.hojas.toLocaleString('es-AR')],
        ['objetos en escena', `${data.objetos}`],
        ['llamadas de dibujo', `${data.llamadas}`],
        ['triángulos', data.triangulos.toLocaleString('es-AR')],
        ['texturas', `${data.texturas}`],
        ['programas glsl', `${data.programas}`],
        ['postprocesado', fx ? 'activo' : 'desactivado (?fx=off)'],
      ]
    : [['estado', 'la escena no está renderizando ningún cuadro']]

  return (
    <div className="diag">
      <p className="diag__title">Diagnóstico · tecla D para ocultar</p>
      <table className="diag__table">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <style>{`
        .diag {
          position: fixed;
          top: 1rem;
          left: 1rem;
          z-index: 20;
          padding: 0.8rem 1rem;
          border-radius: 10px;
          border: 1px solid rgba(94, 234, 212, 0.4);
          background: rgba(4, 10, 18, 0.92);
          font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
          font-size: 0.72rem;
          color: #d7ebfa;
          pointer-events: none;
        }
        .diag__title {
          margin: 0 0 0.5rem;
          font-size: 0.6rem;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: #5eead4;
        }
        .diag__table { border-collapse: collapse; }
        .diag__table td { padding: 0.12rem 0; }
        .diag__table td:first-child {
          padding-right: 1.2rem;
          color: rgba(190, 215, 235, 0.55);
        }
        .diag__table td:last-child {
          font-weight: 600;
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
      `}</style>
    </div>
  )
}
