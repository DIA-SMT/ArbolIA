import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { QR_TARGET } from '../../../lib/config'

/**
 * QR de participación.
 *
 * Va oscuro sobre blanco dentro de una tarjeta clara: es el patrón que más
 * rápido enganchan las cámaras de celular, incluso de costado y con la luz
 * complicada de un pabellón de expo. Estilizarlo con los colores de marca
 * se ve mejor en una maqueta y se escanea peor en el stand.
 */
export default function QRPanel() {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    /*
     * SVG, no PNG, y el motivo es que el QR se achicó.
     *
     * Antes era toDataURL con scale 12: un PNG de ~324px que el CSS AMPLIABA
     * a 428px en el LED. Para ampliar estaba bien, y por eso el CSS pedía
     * image-rendering: pixelated, que conserva los bordes duros.
     *
     * Ahora el QR mide ~240px, así que el mismo PNG habría que REDUCIRLO, en
     * una proporción que no es entera. Reducir con nearest-neighbor deja
     * módulos de distinto ancho —unos de 8px, otros de 9— y un patrón
     * irregular es justo lo que hace dudar a las cámaras. Peor todavía: el
     * tamaño del PNG depende de cuán larga sea la URL, así que la proporción
     * cambiaría con VITE_PUBLIC_URL sin que nadie lo note.
     *
     * En SVG el problema no existe a ningún tamaño. Y el margen sube de 1 a 2
     * módulos: la especificación recomienda 4 de zona de silencio, y entre
     * esto y el padding blanco de la tarjeta se llega a algo razonable.
     */
    QRCode.toString(QR_TARGET, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 2,
      color: { dark: '#050a12', light: '#ffffff' },
    })
      .then((svg) => {
        if (!cancelled) {
          setDataUrl(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`)
        }
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="qr">
      <div className="qr__card">
        {dataUrl ? (
          <img src={dataUrl} alt="Código QR para dejar tu idea" className="qr__img" />
        ) : (
          <div className="qr__fallback" aria-hidden />
        )}
      </div>

      {/*
        Sin la dirección escrita.

        Estaba debajo del código y no sumaba: nadie tipea una URL mirando una
        pantalla que ya tiene el QR al lado, y lo que se leía era un dominio
        de vercel.app en la pantalla de la Municipalidad. La instrucción sola
        alcanza; el código hace el resto.

        QR_TARGET sigue siendo lo que se codifica, y eso no cambia.
      */}
      <div className="qr__text">
        <p className="qr__cta">Escaneá el QR y dejá tu idea.</p>
      </div>
    </div>
  )
}
