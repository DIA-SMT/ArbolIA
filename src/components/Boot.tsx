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
          background:
            radial-gradient(circle at 50% 55%, #0b1727 0%, #050a12 62%);
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
          border: 1px solid rgba(60, 180, 240, 0.35);
          border-top-color: rgba(37, 211, 102, 0.9);
          animation: boot-spin 1.4s linear infinite;
        }
        .boot__ring--slow {
          inset: 14px;
          border-color: rgba(60, 180, 240, 0.16);
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
          color: rgba(190, 215, 235, 0.5);
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
