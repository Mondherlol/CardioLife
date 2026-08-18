import { useState, useEffect } from 'react'
import {
  Wrench, Play, Eye, CheckCircle2, AlertTriangle, Info, CalendarClock, Trash2,
} from 'lucide-react'
import { toast } from 'react-toastify'
import { getMaintenanceTasks, runMaintenanceTask } from '../api/maintenance'

/**
 * Reprises de données, lancées depuis l'application.
 *
 * Les mêmes opérations que les scripts du serveur, pour ne pas dépendre d'un
 * accès SSH quand une fiche affiche une date fausse. Chaque reprise se simule
 * avant de s'exécuter, et le compte rendu détaille ce qui a été fait — sans ça
 * on cliquerait dans le vide.
 */

const fmtDate = d => (d ? new Date(d).toLocaleDateString('fr-FR') : '—')

/** Compte rendu d'un recalcul d'échéances. */
function ResyncReport({ report }) {
  const { totals, contracts, dropped, dry } = report

  return (
    <div className="devfix-report">
      <div className="ci-preview-summary">
        <div className="ci-summary-chip ci-summary-chip--total">
          <CalendarClock size={14} />
          <strong>{totals.contracts}</strong> contrat{totals.contracts !== 1 ? 's' : ''} actif{totals.contracts !== 1 ? 's' : ''}
        </div>
        {!dry && (
          <>
            <div className="ci-summary-chip ci-summary-chip--ok">
              <CheckCircle2 size={14} />
              <strong>{totals.created}</strong> visite{totals.created !== 1 ? 's' : ''} créée{totals.created !== 1 ? 's' : ''}
            </div>
            <div className="ci-summary-chip ci-summary-chip--total">
              <strong>{totals.removed}</strong> remplacée{totals.removed !== 1 ? 's' : ''}
            </div>
          </>
        )}
        {totals.dropped > 0 && (
          <div className="ci-summary-chip ci-summary-chip--error">
            <Trash2 size={14} />
            <strong>{totals.dropped}</strong> visite{totals.dropped !== 1 ? 's' : ''} passée{totals.dropped !== 1 ? 's' : ''}
            {dry ? ' à retirer' : ' retirée' + (totals.dropped !== 1 ? 's' : '')}
          </div>
        )}
      </div>

      <div className="ci-table-wrap">
        <table className="ci-preview-table">
          <thead>
            <tr>
              <th>Contrat</th>
              <th>Site</th>
              <th>Pose de référence</th>
              <th>Échéances au calendrier</th>
              {!dry && <th>Prochain contrôle affiché</th>}
            </tr>
          </thead>
          <tbody>
            {contracts.map((c, i) => (
              <tr key={i} className={c.error ? 'ci-row--error' : ''}>
                <td className="ci-cell-name">{c.number}</td>
                <td>{c.site || <em className="ci-cell--empty">—</em>}</td>
                <td>{fmtDate(c.anchor)}</td>
                <td>
                  {c.error
                    ? <span className="ci-error-inline">{c.error}</span>
                    : c.planned.length === 0
                      ? <em className="ci-cell--empty">aucune dans la période</em>
                      : (
                        <div className="devfix-dates">
                          {c.planned.map((p, j) => (
                            <span key={j} className="devfix-date">
                              {fmtDate(p.date)} <em>{p.type}</em>
                            </span>
                          ))}
                        </div>
                      )}
                </td>
                {!dry && (
                  <td>
                    <strong>{fmtDate(c.nextControl)}</strong>
                    {c.created + c.removed > 0 && (
                      <div className="ci-cell-sub">
                        {c.created} créée{c.created !== 1 ? 's' : ''} · {c.removed} remplacée{c.removed !== 1 ? 's' : ''}
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dropped?.length > 0 && (
        <>
          <p className="ci-legend" style={{ marginTop: 12 }}>
            Visites planifiées avant aujourd'hui et jamais honorées
            {dry ? ' — elles seront retirées si vous exécutez :' : ' — retirées :'}
          </p>
          <div className="ci-table-wrap">
            <table className="ci-preview-table">
              <thead>
                <tr><th>Site</th><th>Date</th><th>Type</th></tr>
              </thead>
              <tbody>
                {dropped.map((d, i) => (
                  <tr key={i}>
                    <td className="ci-cell-name">{d.site}</td>
                    <td>{fmtDate(d.date)}</td>
                    <td>{d.type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function TaskCard({ task }) {
  const [opts,    setOpts]    = useState({})
  const [busy,    setBusy]    = useState(null)   // null | 'dry' | 'run'
  const [report,  setReport]  = useState(null)

  async function launch(dry) {
    setBusy(dry ? 'dry' : 'run')
    try {
      const res = await runMaintenanceTask(task.id, { ...opts, dry })
      setReport(res)
      if (dry) {
        toast.info('Simulation terminée — rien n\'a été écrit.')
      } else {
        toast.success(`${task.label} : terminé.`)
      }
    } catch (err) {
      toast.error(err.message || 'La reprise a échoué.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="devfix-task">
      <div className="devfix-task-head">
        <span className="devfix-task-icon"><Wrench size={16} /></span>
        <div>
          <h3 className="devfix-task-title">{task.label}</h3>
          <p className="devfix-task-desc">{task.description}</p>
        </div>
      </div>

      {task.detail && (
        <p className="ci-legend"><Info size={12} /> {task.detail}</p>
      )}

      {task.options?.length > 0 && (
        <div className="devfix-opts">
          {task.options.map(o => (
            <label key={o.id} className="sp-reset-opt">
              <input type="checkbox" checked={!!opts[o.id]}
                onChange={e => setOpts(v => ({ ...v, [o.id]: e.target.checked }))} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      )}

      {/* Simuler d'abord : le compte rendu dit exactement ce que l'exécution
          changera. C'est le geste par défaut, l'écriture vient après. */}
      <div className="ci-action-row">
        <button className="btn btn--ghost" onClick={() => launch(true)} disabled={!!busy}>
          {busy === 'dry'
            ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Simulation…</>
            : <><Eye size={14} /> Simuler</>}
        </button>
        <button className="btn btn--primary" onClick={() => launch(false)} disabled={!!busy}>
          {busy === 'run'
            ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Exécution…</>
            : <><Play size={14} /> Exécuter</>}
        </button>
      </div>

      {report && (
        <>
          <div className={`devfix-banner${report.dry ? '' : ' devfix-banner--done'}`}>
            {report.dry
              ? <><Eye size={14} /> Simulation — rien n'a été écrit. Relancez avec <strong>Exécuter</strong> pour appliquer.</>
              : <><CheckCircle2 size={14} /> Appliqué en {(report.durationMs / 1000).toFixed(1)} s.</>}
          </div>
          {report.task === 'resync-controls' && <ResyncReport report={report} />}
        </>
      )}
    </div>
  )
}

export default function DevFixPanel() {
  const [tasks,   setTasks]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    getMaintenanceTasks()
      .then(d => setTasks(Array.isArray(d) ? d : []))
      .catch(err => setError(err.message || 'Chargement impossible.'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="table-loading"><span className="spinner" /></div>

  return (
    <>
      <h2 className="sp-section-title">Dev Fix</h2>
      <p className="sp-section-desc">
        Reprises de données, sans passer par le serveur. Ce sont les mêmes
        opérations que les scripts de maintenance : ce qui tourne ici est
        exactement ce qui tourne en ligne de commande.
      </p>

      <div className="sp-reset-keep" style={{ marginBottom: 16 }}>
        <AlertTriangle size={13} />
        <span>
          Ces reprises <strong>réécrivent des données métier</strong>. Simulez d'abord :
          le compte rendu montre ce qui changera avant que quoi que ce soit ne soit écrit.
        </span>
      </div>

      {error && <div className="table-error"><AlertTriangle size={15} /> {error}</div>}

      {tasks.length === 0 && !error
        ? <div className="sp-placeholder">
            <Wrench size={40} strokeWidth={1.2} />
            <p style={{ marginTop: 12 }}>Aucune reprise disponible.</p>
          </div>
        : tasks.map(t => <TaskCard key={t.id} task={t} />)}
    </>
  )
}
