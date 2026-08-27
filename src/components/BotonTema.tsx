import type { Tema } from '../lib/tema'
import './botonTema.css'

/**
 * Alterna fondo claro y oscuro.
 *
 * Va en el celular y en el panel, no en la pantalla del stand: eso se
 * proyecta, y cualquier control visible es ruido sobre la imagen que ve el
 * público. Ahí el mismo cambio está en Ctrl+L.
 */
export default function BotonTema({
  tema,
  onAlternar,
}: {
  tema: Tema
  onAlternar: () => void
}) {
  const aClaro = tema === 'oscuro'

  return (
    <button
      type="button"
      className="tema"
      onClick={onAlternar}
      // El texto describe lo que va a pasar al tocarlo, no el estado
      // actual. Un lector de pantalla que anuncia "modo oscuro" sobre un
      // botón deja al usuario sin saber si eso es lo que hay o lo que va
      // a haber.
      aria-label={aClaro ? 'Cambiar a fondo claro' : 'Cambiar a fondo oscuro'}
      title={aClaro ? 'Fondo claro' : 'Fondo oscuro'}
    >
      <span className="tema__icono" aria-hidden>
        {aClaro ? '☀' : '☾'}
      </span>
    </button>
  )
}
