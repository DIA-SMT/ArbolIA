import { createRoot } from 'react-dom/client'
import App from './App'
import { aplicarTema, temaInicial } from './lib/tema'
import './styles/global.css'

const container = document.getElementById('root')
if (!container) throw new Error('No se encontró el nodo #root')

/*
 * El tema se aplica ANTES del primer render.
 *
 * Cada ruta lo aplica por su cuenta al montar, pero las rutas se cargan con
 * lazy() y hasta que llegan se ve <Boot />. Ese cuadro se dibujaba sin
 * data-tema en el html, o sea siempre con los tokens oscuros, y en tema
 * claro la carga era un flash negro a pantalla completa antes del blanco.
 *
 * Acá vale para las tres rutas y no hace falta duplicar la regla: la
 * decide temaInicial(), que es la misma que después aplica useTema.
 */
aplicarTema(temaInicial())

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
