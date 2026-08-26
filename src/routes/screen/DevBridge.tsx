import { useEffect } from 'react'
import { advance, useThree } from '@react-three/fiber'

/**
 * Puente de desarrollo (sólo en `vite dev`, se elimina del build de producción).
 *
 * Expone el renderer y un avance manual del frameloop en `window.__arbolia`.
 * Sirve para dos cosas concretas durante el armado de la instalación:
 *  - capturar cuadros de la escena sin depender del rAF del navegador
 *  - forzar un tamaño de render y previsualizar cómo cae el encuadre en el
 *    LED del stand sin tener el LED delante
 */
export default function DevBridge() {
  const { gl, scene, camera, setSize } = useThree()

  useEffect(() => {
    if (!import.meta.env.DEV) return

    const api = {
      gl,
      scene,
      camera,
      setSize,
      /** Avanza N frames simulando `stepMs` entre cada uno. */
      step(frames = 1, stepMs = 16.7) {
        let t = performance.now()
        for (let i = 0; i < frames; i++) {
          t += stepMs
          advance(t)
        }
      },
      /** Devuelve el frame actual como data URL PNG. */
      capture() {
        return gl.domElement.toDataURL('image/png')
      },
    }

    ;(window as unknown as { __arbolia?: typeof api }).__arbolia = api

    return () => {
      delete (window as unknown as { __arbolia?: typeof api }).__arbolia
    }
  }, [gl, scene, camera, setSize])

  return null
}
