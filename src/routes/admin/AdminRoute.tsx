import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { IS_SUPABASE_CONFIGURED } from '../../lib/config'
import {
  EMPTY_STATS,
  fetchAdminIdeas,
  fetchGoal,
  fetchStats,
  fetchTimeline,
  resetStats,
  setGoal,
  setIdeaStatus,
  type TimelinePoint,
} from '../../lib/api'
import TimelineChart from './TimelineChart'
import AreasDonut from './AreasDonut'
import MiguePanel from './MiguePanel'
import { GOAL_FALLBACK } from '../../lib/config'
import { CATEGORIES, getCategory } from '../../lib/categories'
import type { CategorySlug, Idea, IdeaStatus, Stats } from '../../lib/types'
import './admin.css'

const REFRESH_MS = 45_000
const RESET_PHRASE = 'REINICIAR'

type CategoryFilter = CategorySlug | 'all'
type StatusFilter = IdeaStatus | 'all'

export default function AdminRoute() {
  const [session, setSession] = useState<'checking' | 'out' | 'in'>('checking')

  useEffect(() => {
    document.body.dataset.route = 'admin'
    return () => {
      delete document.body.dataset.route
    }
  }, [])

  useEffect(() => {
    if (!IS_SUPABASE_CONFIGURED || !supabase) {
      setSession('out')
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ? 'in' : 'out')
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ? 'in' : 'out')
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === 'checking') {
    return <div className="adm adm--empty">Verificando sesión…</div>
  }

  if (session === 'out') return <LoginPanel />

  return <Dashboard />
}

// ---------------------------------------------------------------------
// Ingreso
// ---------------------------------------------------------------------

function LoginPanel() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!supabase) {
      setError('Supabase no está configurado en este entorno.')
      return
    }

    setBusy(true)
    setError(null)

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    setBusy(false)
    if (authError) setError('No pudimos ingresar. Revisá el correo y la contraseña.')
  }

  return (
    <div className="adm adm--login">
      <form className="login" onSubmit={handleLogin}>
        <p className="login__kicker">Árbol Virtual de Ideas</p>
        <h1 className="login__title">Panel de moderación</h1>
        <p className="login__sub">Acceso del equipo de la Municipalidad.</p>

        <label className="login__field">
          <span>Correo</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </label>

        <label className="login__field">
          <span>Contraseña</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error && <p className="login__error">{error}</p>}

        <button type="submit" className="login__btn" disabled={busy}>
          {busy ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------

function Dashboard() {
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [stats, setStats] = useState<Stats>(EMPTY_STATS)
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<TimelinePoint[]>([])
  const [horas, setHoras] = useState(24)
  const [goal, setGoalState] = useState(GOAL_FALLBACK)

  const load = useCallback(async () => {
    try {
      const [rows, freshStats, serie, meta] = await Promise.all([
        fetchAdminIdeas({ category, status, search }),
        fetchStats(),
        fetchTimeline(horas),
        fetchGoal(),
      ])
      setIdeas(rows)
      setStats(freshStats)
      setTimeline(serie)
      if (meta) setGoalState(meta)
      setError(null)
    } catch {
      setError('No pudimos actualizar los datos.')
    } finally {
      setLoading(false)
    }
  }, [category, status, search, horas])

  useEffect(() => {
    void load()
  }, [load])

  /*
   * Moderación en tiempo real.
   *
   * Antes esto era un refresco cada 12 segundos. Para moderar no alcanza:
   * si se cuela una groserÍa, esos 12 segundos son 12 segundos con el texto
   * proyectado delante del público. Con la suscripción, la idea aparece en
   * la lista apenas entra a la base.
   *
   * El intervalo queda igual, pero espaciado y como red: si el socket se
   * cae —el WiFi de un predio de expo no es confiable— el panel se sigue
   * actualizando solo, sin que nadie tenga que apretar nada.
   */
  useEffect(() => {
    if (!supabase) return

    const canal = supabase
      .channel('arbolia-panel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ideas' }, () => {
        void load()
      })
      .subscribe()

    return () => {
      void supabase?.removeChannel(canal)
    }
  }, [load])

  // Red de respaldo por si el socket se cae.
  useEffect(() => {
    const timer = window.setInterval(() => void load(), REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [load])

  const pendingReview = useMemo(
    () => ideas.filter((i) => i.status === 'flagged').length,
    [ideas],
  )

  async function moderate(id: string, next: IdeaStatus) {
    setBusyId(id)
    try {
      await setIdeaStatus(id, next)
      setIdeas((prev) => prev.map((i) => (i.id === id ? { ...i, status: next } : i)))
      void fetchStats().then(setStats).catch(() => undefined)
    } catch {
      setError('No pudimos aplicar el cambio.')
    } finally {
      setBusyId(null)
    }
  }

  const ranking = useMemo(
    () => [...stats.byCategory].sort((a, b) => b.total - a.total),
    [stats.byCategory],
  )

  return (
    <div className="adm">
      <header className="adm__bar">
        <div>
          <p className="adm__kicker">Árbol Virtual de Ideas · ExpoCom 2026</p>
          <h1 className="adm__title">Panel de moderación</h1>
        </div>

        <div className="adm__bar-actions">
          <button className="btn btn--ghost" onClick={() => void load()}>
            Actualizar
          </button>
          <button className="btn btn--ghost" onClick={() => void supabase?.auth.signOut()}>
            Salir
          </button>
        </div>
      </header>

      {error && <p className="adm__alert">{error}</p>}

      {/* ---------- Métricas ---------- */}
      <section className="cards">
        <Card label="Ciudadanos participando" value={stats.participants} />
        <Card label="Ideas publicadas" value={stats.ideas} accent />
        <Card label="Áreas de la ciudad" value={stats.areas} />
        <Card
          label="Pendientes de revisión"
          value={pendingReview}
          warn={pendingReview > 0}
        />
      </section>

      {/* ---------- Evolución ---------- */}
      <TimelineChart data={timeline} horas={horas} onCambiarRango={setHoras} />

      <div className="adm__grid">
        {/* ---------- Listado ---------- */}
        <section className="list">
          <div className="filters">
            <input
              className="filters__search"
              type="search"
              placeholder="Buscar en las ideas…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <select
              className="filters__select"
              value={category}
              onChange={(e) => setCategory(e.target.value as CategoryFilter)}
            >
              <option value="all">Todas las áreas</option>
              {CATEGORIES.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.emoji} {c.label}
                </option>
              ))}
            </select>

            <select
              className="filters__select"
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
            >
              <option value="all">Todos los estados</option>
              <option value="visible">Publicadas</option>
              <option value="flagged">Pendientes de revisión</option>
              <option value="hidden">Retiradas</option>
            </select>
          </div>

          {loading ? (
            <p className="list__empty">Cargando ideas…</p>
          ) : ideas.length === 0 ? (
            <p className="list__empty">No hay ideas que coincidan con el filtro.</p>
          ) : (
            <ul className="list__items">
              {ideas.map((idea) => {
                const cat = getCategory(idea.category)
                return (
                  <li
                    key={idea.id}
                    className={`row row--${idea.status}`}
                    style={{ ['--row' as string]: cat.color }}
                  >
                    <div className="row__main">
                      <p className="row__text">{idea.text}</p>
                      <div className="row__meta">
                        <span className="row__cat">
                          {cat.emoji} {cat.label}
                        </span>
                        <span className="row__time">
                          {new Date(idea.created_at).toLocaleString('es-AR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        <StatusPill status={idea.status} />
                      </div>
                      {/*
                        Por qué está en la cola. Sin esto, quien modera lee
                        una propuesta que parece inofensiva y no entiende por
                        qué frenó — y la publica sin mirarla dos veces.
                      */}
                      {idea.revision_motivo && idea.status === 'flagged' && (
                        <p className="row__motivo">
                          <span aria-hidden>⚑</span> {idea.revision_motivo}
                        </p>
                      )}
                    </div>

                    <div className="row__actions">
                      {idea.status !== 'visible' && (
                        <button
                          className="btn btn--ok"
                          disabled={busyId === idea.id}
                          onClick={() => void moderate(idea.id, 'visible')}
                        >
                          Publicar
                        </button>
                      )}
                      {idea.status !== 'hidden' && (
                        <button
                          className="btn btn--danger"
                          disabled={busyId === idea.id}
                          onClick={() => void moderate(idea.id, 'hidden')}
                        >
                          Retirar
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* ---------- Lateral ---------- */}
        <aside className="side">
          <div className="side__box">
            <h2 className="side__title">Participación por área</h2>
            <AreasDonut areas={ranking} />
          </div>

          <div className="side__box">
            <h2 className="side__title">Meta de ideas</h2>
            <MetaControl
              valor={goal}
              onGuardado={(nuevo) => {
                setGoalState(nuevo)
                void load()
              }}
            />
          </div>

          <div className="side__box side__box--danger">
            <h2 className="side__title">Reiniciar estadísticas</h2>
            <p className="side__note">
              Archiva todas las ideas y deja el árbol y los contadores en cero.
              No borra nada: los datos quedan guardados para el análisis
              posterior de ExpoCom.
            </p>

            {!resetOpen ? (
              <button className="btn btn--danger" onClick={() => setResetOpen(true)}>
                Reiniciar…
              </button>
            ) : (
              <ResetConfirm
                onCancel={() => setResetOpen(false)}
                onDone={() => {
                  setResetOpen(false)
                  void load()
                }}
              />
            )}
          </div>
        </aside>
      </div>

      {/* ---------- Asistente ---------- */}
      <MiguePanel ideas={ideas} stats={stats} />
    </div>
  )
}

// ---------------------------------------------------------------------

function Card({
  label,
  value,
  accent,
  warn,
}: {
  label: string
  value: number
  accent?: boolean
  warn?: boolean
}) {
  return (
    <div className={`card ${accent ? 'card--accent' : ''} ${warn ? 'card--warn' : ''}`}>
      <p className="card__label">{label}</p>
      <p className="card__value">{value.toLocaleString('es-AR')}</p>
    </div>
  )
}

function StatusPill({ status }: { status: IdeaStatus }) {
  const map: Record<IdeaStatus, string> = {
    visible: 'Publicada',
    flagged: 'Pendiente de revisión',
    hidden: 'Retirada',
  }
  return <span className={`pill pill--${status}`}>{map[status]}</span>
}

/**
 * Meta de ideas, editable en caliente.
 *
 * Vive en la base, no en el build: si el primer día la participación va
 * mucho más rápido o mucho más lento de lo previsto, el equipo mueve la
 * meta desde acá y la pantalla la toma sola en menos de treinta segundos,
 * sin desplegar nada. Los tramos de crecimiento del árbol se recalculan
 * con la meta nueva.
 */
function MetaControl({
  valor,
  onGuardado,
}: {
  valor: number
  onGuardado: (nuevo: number) => void
}) {
  const [texto, setTexto] = useState(String(valor))
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)

  useEffect(() => {
    setTexto(String(valor))
  }, [valor])

  const numero = Number(texto)
  const valido = Number.isInteger(numero) && numero >= 10 && numero <= 100000
  const cambio = valido && numero !== valor

  async function guardar() {
    if (!cambio) return
    setGuardando(true)
    setMensaje(null)
    try {
      const nuevo = await setGoal(numero)
      onGuardado(nuevo)
      setMensaje('Meta actualizada.')
      window.setTimeout(() => setMensaje(null), 3000)
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : 'No pudimos guardar la meta.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div>
      <div className="meta__row">
        <input
          className="meta__input"
          type="number"
          min={10}
          max={100000}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void guardar()
          }}
        />
        <button className="btn" disabled={!cambio || guardando} onClick={() => void guardar()}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>

      <p className={`meta__hint ${mensaje === 'Meta actualizada.' ? 'meta__ok' : ''}`}>
        {mensaje ??
          (valido
            ? 'La pantalla toma el cambio en menos de 30 segundos, sin recargar.'
            : 'Tiene que ser un número entre 10 y 100.000.')}
      </p>
    </div>
  )
}

/**
 * Confirmación escrita para el reinicio.
 *
 * Es la única acción del panel que no se puede deshacer desde la interfaz,
 * y se opera en un stand con gente alrededor: un botón suelto es demasiado
 * fácil de apretar por accidente.
 */
function ResetConfirm({
  onCancel,
  onDone,
}: {
  onCancel: () => void
  onDone: () => void
}) {
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    try {
      const affected = await resetStats()
      setResult(`Se archivaron ${affected} ideas.`)
      window.setTimeout(onDone, 1400)
    } catch {
      setResult('No se pudo reiniciar.')
      setBusy(false)
    }
  }

  return (
    <div className="reset">
      <p className="reset__ask">
        Escribí <strong>{RESET_PHRASE}</strong> para confirmar.
      </p>
      <input
        className="reset__input"
        value={phrase}
        onChange={(e) => setPhrase(e.target.value)}
        placeholder={RESET_PHRASE}
        autoFocus
      />
      {result && <p className="reset__result">{result}</p>}
      <div className="reset__actions">
        <button className="btn btn--ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        <button
          className="btn btn--danger"
          disabled={phrase.trim().toUpperCase() !== RESET_PHRASE || busy}
          onClick={() => void run()}
        >
          {busy ? 'Reiniciando…' : 'Confirmar reinicio'}
        </button>
      </div>
    </div>
  )
}
