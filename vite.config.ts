import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { apiLocal } from './vite/apiLocal'

export default defineConfig({
  /*
   * apiLocal sirve la carpeta /api durante `vite dev`. En producción esas
   * funciones las corre Vercel; sin el plugin, en local devolvían 404 y la
   * mitad de la instalación no funcionaba sin que nada fallara a la vista.
   * Sólo se aplica en desarrollo: no existe en el build.
   */
  plugins: [react(), apiLocal()],
  server: { host: true, port: 5173 },
  build: {
    target: 'es2020',
    /**
     * Sin `manualChunks` a propósito.
     *
     * Las tres rutas se cargan con React.lazy, así que el split automático
     * ya deja Three.js fuera del camino crítico: el celular que entra por el
     * QR sólo baja lo suyo. Agrupar los vendors a mano metía el chunk 3D en
     * el grafo inicial y el móvil terminaba descargando el motor de render.
     */
  },
})
