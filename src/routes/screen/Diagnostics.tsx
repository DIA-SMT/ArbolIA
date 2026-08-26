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

  useFrame(() => {
    frames.current += 1
    const now = performance.now()
    const elapsed = now - last.current
    if (elapsed < 500) return

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
      fps: Math.round((frames.current / elapsed) * 1000),
    })

    frames.current = 0
    last.current = now
  })

  return null
}

function countObjects(scene: import('three').Object3D): number {
  let n = 0
  scene.traverse(() => {
    n += 1
  })
  return n
}

/** Panel de lectura, fuera del canvas. */
export function DiagnosticsHud({ data, fx }: { data: DiagInfo | null; fx: boolean }) {
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
        ['fps', `${data.fps}`],
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
