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
          <Route path="*" element={<Navigate to="/idea" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
