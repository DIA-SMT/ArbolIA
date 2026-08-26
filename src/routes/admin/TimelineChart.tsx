import { useMemo, useState } from 'react'
import type { TimelinePoint } from '../../lib/api'

/*
 * Paleta del gráfico.
 *
 * No son los hex de marca tal cual: #25d366 y #F2D91C están pensados para
 * papel blanco y sobre la superficie oscura del panel quedan fuera de la
 * banda de luminosidad admisible. Éstos son pasos más oscuros del mismo
 * verde y del mismo ámbar institucionales — misma identidad, luminosidad
 * correcta para fondo oscuro.
 *
 * Verificado con el validador de paleta contra la superficie #0c1826:
 * banda de luminosidad, croma, piso de visión normal (ΔE 23.7) y contraste
 * pasan. La separación para protanopía queda en ΔE 6.2, que sólo es
 * admisible con codificación secundaria: por eso las barras de "marcadas"
 * llevan rayas además de color, y la leyenda nombra cada serie por texto.
 */
const COLOR_PUBLICADAS = '#16a34a'
const COLOR_MARCADAS = '#d97706'

const W = 720
const H = 200
const PAD = { top: 14, right: 8, bottom: 26, left: 34 }

interface Props {
  data: TimelinePoint[]
  horas: number
  onCambiarRango: (horas: number) => void
}

/**
 * Ideas recibidas hora por hora.
 *
 * Barras apiladas: lo publicado abajo, lo marcado para revisión arriba. Es
 * la forma correcta para magnitud a lo largo del tiempo, y apilarlas
 * responde de un vistazo la pregunta que le importa al equipo: cuánto entró
 * en total y qué proporción hubo que revisar.
 */
export default function TimelineChart({ data, horas, onCambiarRango }: Props) {
  const [activo, setActivo] = useState<number | null>(null)
  const [verTabla, setVerTabla] = useState(false)

  const { barras, maximo, totalPublicadas, totalMarcadas } = useMemo(() => {
    const max = Math.max(1, ...data.map((d) => d.publicadas + d.marcadas))
    const innerW = W - PAD.left - PAD.right
    const innerH = H - PAD.top - PAD.bottom
    const paso = innerW / Math.max(1, data.length)
    // Barras finas con aire entre ellas, con un tope para que en rangos
    // cortos no se conviertan en bloques.
    const ancho = Math.min(22, Math.max(3, paso - 4))

    return {
      maximo: max,
      totalPublicadas: data.reduce((n, d) => n + d.publicadas, 0),
      totalMarcadas: data.reduce((n, d) => n + d.marcadas, 0),
      barras: data.map((d, i) => {
        const total = d.publicadas + d.marcadas
        const x = PAD.left + i * paso + (paso - ancho) / 2
        const hTotal = (total / max) * innerH
        const hMarcadas = (d.marcadas / max) * innerH
        const hPublicadas = hTotal - hMarcadas
        return {
          punto: d,
          index: i,
          x,
          ancho,
          yBase: PAD.top + innerH,
          hPublicadas,
          hMarcadas,
          // Zona de captura de ancho completo: el puntero no tiene que
          // acertarle a una barra de 3 px.
          zonaX: PAD.left + i * paso,
          zonaW: paso,
        }
      }),
    }
  }, [data])

  const hayDatos = totalPublicadas + totalMarcadas > 0
  const punteado = activo !== null ? barras[activo] : null

  return (
    <div className="tl">
      <div className="tl__head">
        <div>
          <p className="tl__title">Ideas recibidas por hora</p>
          <p className="tl__sub">Hora de Tucumán · {totalPublicadas} publicadas</p>
        </div>

        <div className="tl__rangos">
          {[12, 24, 72].map((h) => (
            <button
              key={h}
              type="button"
              className={`tl__rango ${horas === h ? 'tl__rango--on' : ''}`}
              onClick={() => onCambiarRango(h)}
            >
              {h}h
            </button>
          ))}
          <button
            type="button"
            className={`tl__rango ${verTabla ? 'tl__rango--on' : ''}`}
            onClick={() => setVerTabla((v) => !v)}
            title="Ver los mismos datos como tabla"
          >
            Tabla
          </button>
        </div>
      </div>

      {/* Leyenda: la identidad nunca queda librada sólo al color. */}
      <ul className="tl__leyenda">
        <li>
          <span className="tl__chip" style={{ background: COLOR_PUBLICADAS }} />
          Publicadas
        </li>
        <li>
          <span className="tl__chip tl__chip--rayas" style={{ background: COLOR_MARCADAS }} />
          Para revisión ({totalMarcadas})
        </li>
      </ul>

      {verTabla ? (
        <div className="tl__tabla-scroll">
          <table className="tl__tabla">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Publicadas</th>
                <th>Para revisión</th>
                <th>Dispositivos</th>
              </tr>
            </thead>
            <tbody>
              {data
                .filter((d) => d.publicadas + d.marcadas > 0)
                .map((d) => (
                  <tr key={d.hora}>
                    <td>{etiquetaHora(d.hora, true)}</td>
                    <td>{d.publicadas}</td>
                    <td>{d.marcadas}</td>
                    <td>{d.dispositivos}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!hayDatos && <p className="tl__vacio">Todavía no hay ideas en este rango.</p>}
        </div>
      ) : (
        <div className="tl__plot">
          <svg viewBox={`0 0 ${W} ${H}`} className="tl__svg" role="img"
               aria-label={`Ideas por hora en las últimas ${horas} horas`}>
            <defs>
              {/*
                Textura de rayas para la serie "para revisión". Es la
                codificación secundaria que exige la separación de color
                para protanopía: sin esto, verde y ámbar se confunden.
              */}
              <pattern id="tl-rayas" width="6" height="6" patternUnits="userSpaceOnUse"
                       patternTransform="rotate(45)">
                <rect width="6" height="6" fill={COLOR_MARCADAS} />
                <line x1="0" y1="0" x2="0" y2="6" stroke="#0c1826" strokeWidth="2.4" />
              </pattern>
            </defs>

            {/* Grilla recesiva, con la escala en el eje. */}
            {[0, 0.5, 1].map((f) => {
              const y = PAD.top + (H - PAD.top - PAD.bottom) * (1 - f)
              return (
                <g key={f}>
                  <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y}
                        stroke="rgba(60,180,240,0.12)" strokeWidth="1" />
                  <text x={PAD.left - 6} y={y + 3} textAnchor="end" className="tl__tick">
                    {Math.round(maximo * f)}
                  </text>
                </g>
              )
            })}

            {barras.map((b) => (
              <g key={b.punto.hora}>
                {/* Publicadas: apoyadas en la base. */}
                {b.hPublicadas > 0 && (
                  <rect
                    x={b.x}
                    y={b.yBase - b.hPublicadas}
                    width={b.ancho}
                    height={b.hPublicadas}
                    rx={Math.min(4, b.ancho / 2)}
                    fill={COLOR_PUBLICADAS}
                    opacity={activo === null || activo === b.index ? 1 : 0.45}
                  />
                )}
                {/* Para revisión: encima, con 2 px de aire entre rellenos. */}
                {b.hMarcadas > 0 && (
                  <rect
                    x={b.x}
                    y={b.yBase - b.hPublicadas - b.hMarcadas - (b.hPublicadas > 0 ? 2 : 0)}
                    width={b.ancho}
                    height={b.hMarcadas}
                    rx={Math.min(4, b.ancho / 2)}
                    fill="url(#tl-rayas)"
                    opacity={activo === null || activo === b.index ? 1 : 0.45}
                  />
                )}
                {/* Zona de captura del puntero. */}
                <rect
                  x={b.zonaX}
                  y={PAD.top}
                  width={b.zonaW}
                  height={H - PAD.top - PAD.bottom}
                  fill="transparent"
                  onMouseEnter={() => setActivo(b.index)}
                  onMouseLeave={() => setActivo(null)}
                />
              </g>
            ))}

            {/* Etiquetas selectivas del eje: una de cada cuatro. */}
            {barras.map((b, i) =>
              i % Math.ceil(barras.length / 6) === 0 ? (
                <text
                  key={`t-${b.punto.hora}`}
                  x={b.zonaX + b.zonaW / 2}
                  y={H - 8}
                  textAnchor="middle"
                  className="tl__tick"
                >
                  {etiquetaHora(b.punto.hora)}
                </text>
              ) : null,
            )}
          </svg>

          {punteado && (
            <div
              className="tl__tip"
              style={{ left: `${((punteado.zonaX + punteado.zonaW / 2) / W) * 100}%` }}
            >
              <strong>{etiquetaHora(punteado.punto.hora, true)}</strong>
              <span>{punteado.punto.publicadas} publicadas</span>
              {punteado.punto.marcadas > 0 && (
                <span className="tl__tip-warn">
                  {punteado.punto.marcadas} para revisión
                </span>
              )}
              <span className="tl__tip-muted">
                {punteado.punto.dispositivos}{' '}
                {punteado.punto.dispositivos === 1 ? 'dispositivo' : 'dispositivos'}
              </span>
            </div>
          )}

          {!hayDatos && (
            <p className="tl__vacio tl__vacio--sobre">
              Todavía no hay ideas en este rango.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** "14 h" o, con fecha, "mar 14 h". */
function etiquetaHora(iso: string, conDia = false): string {
  const d = new Date(iso)
  const hora = `${String(d.getHours()).padStart(2, '0')} h`
  if (!conDia) return hora
  const dia = d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric' })
  return `${dia}, ${hora}`
}
