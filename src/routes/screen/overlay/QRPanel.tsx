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

    QRCode.toDataURL(QR_TARGET, {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 12,
      color: { dark: '#050a12', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url)
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

      <div className="qr__text">
        <p className="qr__cta">Escaneá el QR y dejá tu idea.</p>
        <p className="qr__url">{QR_TARGET.replace(/^https?:\/\//, '')}</p>
      </div>
    </div>
  )
}
