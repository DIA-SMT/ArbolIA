/**
 * Pantalla de carga. Se ve durante el arranque del bundle 3D, así que
 * tiene que sostener el tono de la instalación: nada de spinners genéricos.
 */
export default function Boot() {
  return (
    <div className="boot">
      <div className="boot__mark">
        <span className="boot__ring" />
        <span className="boot__ring boot__ring--slow" />
        <span className="boot__seed" />
      </div>
      <p className="boot__label">La ciudad te escucha</p>

      <style>{`
        .boot {
          position: fixed;
          inset: 0;
          display: grid;
          place-content: center;
          justify-items: center;
          gap: 2.2rem;
          /*
           * El fondo sigue al tema.
           *
           * Estaba clavado en el degradado oscuro, así que entrar a
           * cualquiera de las tres rutas en tema claro empezaba con un
           * cuadro negro a pantalla completa y saltaba a blanco al montar
           * la app. En el celular del vecino, que es donde más se nota
           * porque el bundle es chico y la carga dura poco, ese flash era
           * lo primero que veía.
           */
          background:
            radial-gradient(circle at 50% 55%, var(--boot-alto) 0%, var(--boot-bajo) 62%);
        }
        .boot__mark {
          position: relative;
          width: 92px;
          height: 92px;
          display: grid;
          place-items: center;
        }
        .boot__ring {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          border: 1px solid var(--boot-anillo);
          border-top-color: rgba(37, 211, 102, 0.9);
          animation: boot-spin 1.4s linear infinite;
        }
        .boot__ring--slow {
          inset: 14px;
          border-color: var(--boot-anillo-tenue);
          border-bottom-color: rgba(60, 180, 240, 0.7);
          animation-duration: 2.6s;
          animation-direction: reverse;
        }
        .boot__seed {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #25d366;
          box-shadow: 0 0 18px 4px rgba(37, 211, 102, 0.7);
          animation: boot-pulse 1.8s ease-in-out infinite;
        }
        .boot__label {
          margin: 0;
          font-family: 'Sora', system-ui, sans-serif;
          font-size: 0.78rem;
          font-weight: 500;
          letter-spacing: 0.42em;
          text-transform: uppercase;
          color: var(--boot-texto);
        }
        /*
         * Los valores del tema oscuro son EXACTAMENTE los que había. En
         * claro se invierten los roles: el degradado va de blanco al gris
         * azulado del fondo profundo, y los anillos pasan de ser luz sobre
         * negro a ser trazo sobre papel.
         */
        .boot {
          --boot-alto: #0b1727;
          --boot-bajo: #050a12;
          --boot-texto: rgba(190, 215, 235, 0.5);
          --boot-anillo: rgba(60, 180, 240, 0.35);
          --boot-anillo-tenue: rgba(60, 180, 240, 0.16);
        }
        :root[data-tema='claro'] .boot {
          --boot-alto: #ffffff;
          --boot-bajo: #eef4fa;
          --boot-texto: rgba(51, 65, 79, 0.75);
          --boot-anillo: rgba(18, 111, 245, 0.28);
          --boot-anillo-tenue: rgba(18, 111, 245, 0.12);
        }
        @keyframes boot-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes boot-pulse {
          0%, 100% { transform: scale(1);   opacity: 1; }
          50%      { transform: scale(1.5); opacity: 0.55; }
        }
      `}</style>
    </div>
  )
}
