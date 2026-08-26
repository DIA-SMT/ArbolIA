import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/global.css'

const container = document.getElementById('root')
if (!container) throw new Error('No se encontró el nodo #root')

/**
 * Sin <StrictMode> global, a propósito.
 *
 * StrictMode monta, desmonta y vuelve a montar cada componente en desarrollo.
 * Las librerías que administran recursos de GPU liberan todo en la limpieza
 * del desmontaje —incluido el EffectComposer de @react-three/postprocessing,
 * que hace composer.dispose()— y en el segundo montaje quedan trabajando
 * sobre objetos ya destruidos. Resultado: pantalla en negro sin ningún error.
 *
 * Las rutas que no tocan WebGL sí corren en StrictMode: ver App.tsx.
 */
createRoot(container).render(<App />)
