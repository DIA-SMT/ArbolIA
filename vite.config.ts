import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
