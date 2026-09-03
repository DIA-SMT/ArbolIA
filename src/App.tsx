import { lazy, StrictMode, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Boot from './components/Boot'

/**
 * Tres experiencias, un solo deploy:
 *   /       pantalla de la instalación (LED / proyector)
 *   /idea   web móvil a la que lleva el QR
 *   /admin  panel del equipo municipal
 *
 * El bundle de Three.js sólo lo baja la pantalla: el celular del vecino
 * nunca descarga el motor 3D.
 */
const ScreenRoute = lazy(() => import('./routes/screen/ScreenRoute'))
const MobileRoute = lazy(() => import('./routes/mobile/MobileRoute'))
const AdminRoute = lazy(() => import('./routes/admin/AdminRoute'))

/**
 * Banco de pruebas de la fauna, en /bicho. SÓLO EN DESARROLLO.
 *
 * El import dinámico está adentro del ternario a propósito. En el build,
 * import.meta.env.DEV es la constante false, así que esta rama se descarta
 * y el import() jamás se evalúa: Rollup no genera el chunk y la ruta no
 * existe en producción. Escrito al revés —lazy() afuera y el guard sólo en
 * el <Route>— el chunk se empaquetaría igual, apagado pero presente.
 */
const BichoRoute = import.meta.env.DEV
  ? lazy(() => import('./routes/bicho/BichoRoute'))
  : null

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Boot />}>
        <Routes>
          {/* La pantalla queda fuera de StrictMode: ver la nota en main.tsx. */}
          <Route path="/" element={<ScreenRoute />} />

          <Route
            path="/idea"
            element={
              <StrictMode>
                <MobileRoute />
              </StrictMode>
            }
          />
          <Route
            path="/admin"
            element={
              <StrictMode>
                <AdminRoute />
              </StrictMode>
            }
          />
          {/* Taller de la fauna. No existe en el build de producción. */}
          {BichoRoute && <Route path="/bicho" element={<BichoRoute />} />}

          <Route path="*" element={<Navigate to="/idea" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
