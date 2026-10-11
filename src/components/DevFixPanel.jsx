import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Wrench, Play, Eye, CheckCircle2, AlertTriangle, Info, CalendarClock, Trash2,
  ClipboardList, Boxes, FileSpreadsheet, Download, RotateCcw,
} from 'lucide-react'
import { toast } from 'react-toastify'
import { getMaintenanceTasks, runMaintenanceTask } from '../api/maintenance'
import { downloadBackup } from '../api/appSettings'

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

const TYPE_SHORT = { semestriel: 'Semestriel', annuel: 'Annuel' }

/**
 * Simulation du recalage des contrôles : un bloc par site, une ligne par
 * changement, une case à cocher par site. Seuls les sites cochés sont modifiés.
 */
function RecalageReport({ report, task, onApplied }) {
  const actionable = report.sites.filter(s => s.changes.some(c => c.action !== 'unmatched'))
  const [checked, setChecked] = useState(() => new Set(actionable.map(s => s.siteId)))
  const [busy,    setBusy]    = useState(false)

  const toggle = id => setChecked(cur => {
    const next = new Set(cur)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const allOn = actionable.length > 0 && actionable.every(s => checked.has(s.siteId))

  async function apply() {
    if (!checked.size) return
    if (!window.confirm(`Recaler le calendrier de ${checked.size} site${checked.size > 1 ? 's' : ''} ?`)) return
    setBusy(true)
    try {
      const res = await runMaintenanceTask(task.id, { dry: false, selection: [...checked] })
      toast.success(`${res.totals.applied} site${res.totals.applied > 1 ? 's' : ''} recalé${res.totals.applied > 1 ? 's' : ''}.`)
      onApplied(res)
    } catch (err) {
      toast.error(err.message || 'Le recalage a échoué.')
    } finally {
      setBusy(false)
    }
  }

  const line = c => {
    if (c.action === 'create') {
      return <>
        <strong>Créer</strong> un contrôle {TYPE_SHORT[c.toType].toLowerCase()} au {fmtDate(c.toDate)}
        {c.late && <span className="rc-late"> — en retard{c.skipped ? ` (${c.skipped} visite${c.skipped > 1 ? 's' : ''} plus ancienne${c.skipped > 1 ? 's' : ''} non recréée${c.skipped > 1 ? 's' : ''})` : ''}</span>}
      </>
    }
    if (c.action === 'duplicate') {
      return <>
        <strong>Supprimer</strong> {c.label} : doublon de {c.of}, le même jour
        <span className="rc-firm"> (copie gardée dans l'historique des suppressions)</span>
      </>
    }
    if (c.action === 'unmatched') {
      return <span className="rc-muted">{c.label} : aucune échéance proche, laissé tel quel</span>
    }
    return <>
      {c.label}{c.firm && <span className="rc-firm"> (déjà calé)</span>} →{' '}
      <strong>{TYPE_SHORT[c.toType]}</strong>
      {c.action === 'move' && <> au <strong>{fmtDate(c.toDate)}</strong></>}
    </>
  }

  if (!report.sites.length) {
    return <p className="ci-legend"><CheckCircle2 size={12} /> Tous les calendriers sont déjà dans l'ordre.</p>
  }

  return (
    <div className="devfix-report">
      <p className="ci-legend">
        <Info size={12} /> {report.sites.length} site{report.sites.length > 1 ? 's' : ''} concerné{report.sites.length > 1 ? 's' : ''} :
        {' '}{report.totals.retype} type{report.totals.retype > 1 ? 's' : ''} corrigé{report.totals.retype > 1 ? 's' : ''},
        {' '}{report.totals.move} déplacement{report.totals.move > 1 ? 's' : ''},
        {' '}{report.totals.create} visite{report.totals.create > 1 ? 's' : ''} à créer
        {report.totals.duplicate ? `, ${report.totals.duplicate} doublon${report.totals.duplicate > 1 ? 's' : ''} à supprimer` : ''}.
      </p>

      {report.dry && actionable.length > 0 && (
        <div className="rc-toolbar">
          <label className="sp-reset-opt">
            <input type="checkbox" checked={allOn}
              onChange={() => setChecked(allOn ? new Set() : new Set(actionable.map(s => s.siteId)))} />
            <span>Tout cocher</span>
          </label>
          <button className="btn btn--primary" onClick={apply} disabled={busy || !checked.size}>
            {busy
              ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Application…</>
              : <><Play size={14} /> Appliquer aux {checked.size} site{checked.size > 1 ? 's' : ''} coché{checked.size > 1 ? 's' : ''}</>}
          </button>
        </div>
      )}

      <div className="rc-sites">
        {report.sites.map(s => {
          const canApply = report.dry && actionable.includes(s)
          return (
            <div key={s.siteId} className={`rc-site${canApply && !checked.has(s.siteId) ? ' rc-site--off' : ''}`}>
              <label className="rc-site-head">
                {canApply && <input type="checkbox" checked={checked.has(s.siteId)} onChange={() => toggle(s.siteId)} />}
                <span className="rc-site-name">{s.client}{s.site && s.site !== s.client ? ` — ${s.site}` : ''}</span>
                <span className="rc-site-last">
                  dernier : {TYPE_SHORT[s.last.type].toLowerCase()} du {fmtDate(s.last.date)}
                </span>
                {!report.dry && s.applied && <span className="rc-done"><CheckCircle2 size={12} /> recalé</span>}
              </label>
              <ul className="rc-changes">
                {s.changes.map((c, i) => <li key={i}>{line(c)}</li>)}
              </ul>
            </div>
          )
        })}
      </div>
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
        {/* Une reprise par sélection ne s'exécute qu'après la simulation,
            sur les lignes cochées. */}
        {!task.selectable && (
          <button className="btn btn--primary" onClick={() => launch(false)} disabled={!!busy}>
            {busy === 'run'
              ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Exécution…</>
              : <><Play size={14} /> Exécuter</>}
          </button>
        )}
      </div>

      {report && (
        <>
          <div className={`devfix-banner${report.dry ? '' : ' devfix-banner--done'}`}>
            {report.dry
              ? <><Eye size={14} /> Simulation — rien n'a été écrit.
                  {task.selectable
                    ? <> Cochez les sites à corriger, puis <strong>Appliquer</strong>.</>
                    : <> Relancez avec <strong>Exécuter</strong> pour appliquer.</>}</>
              : <><CheckCircle2 size={14} /> Appliqué en {(report.durationMs / 1000).toFixed(1)} s.</>}
          </div>
          {report.task === 'resync-controls' && <ResyncReport report={report} />}
          {report.task === 'resync-fiches'   && <FicheSyncReport report={report} />}
          {report.task === 'split-stock-lots' && <SplitLotsReport report={report} />}
          {report.task === 'recaler-controles' && (
            <RecalageReport key={`${report.dry}-${report.durationMs}`} report={report} task={task} onApplied={setReport} />
          )}
        </>
      )}
    </div>
  )
}

/** Compte rendu d'une remontée des checklists sur le parc. */
function FicheSyncReport({ report }) {
  const { totals, sites, dry } = report

  if (!sites.length) {
    return (
      <div className="devfix-report">
        <p className="ci-legend">
          Les fiches clients sont déjà à jour : aucune visite clôturée n'apporte
          de valeur que le parc ne connaisse pas.
        </p>
      </div>
    )
  }

  return (
    <div className="devfix-report">
      <div className="ci-preview-summary">
        <div className="ci-summary-chip ci-summary-chip--total">
          <ClipboardList size={14} />
          <strong>{totals.visits}</strong> visite{totals.visits !== 1 ? 's' : ''} clôturée{totals.visits !== 1 ? 's' : ''}
        </div>
        <div className="ci-summary-chip">
          <CheckCircle2 size={14} />
          <strong>{totals.changes}</strong> valeur{totals.changes !== 1 ? 's' : ''}
          {dry ? ' à reporter' : ' reportée' + (totals.changes !== 1 ? 's' : '')}
          {' '}sur {totals.sites} site{totals.sites !== 1 ? 's' : ''}
        </div>
      </div>

      <div className="ci-table-wrap">
        <table className="ci-preview-table">
          <thead>
            <tr>
              <th>Site</th>
              <th>Dernière visite</th>
              <th>{dry ? 'À reporter sur la fiche client' : 'Reporté sur la fiche client'}</th>
            </tr>
          </thead>
          <tbody>
            {sites.map((s, i) => (
              <tr key={i}>
                <td className="ci-cell-name">{s.site}</td>
                <td>
                  {fmtDate(s.date)}
                  <div className="ci-cell-sub">{s.visits} visite{s.visits !== 1 ? 's' : ''}</div>
                </td>
                <td>
                  <div className="devfix-dates">
                    {s.changes.map((c, j) => <span key={j} className="devfix-date">{c}</span>)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Compte rendu d'un éclatement des lots en lignes unitaires. */
function SplitLotsReport({ report }) {
  const { totals, lines, dry } = report

  if (!lines.length) {
    return (
      <div className="devfix-report">
        <p className="ci-legend">
          Aucune ligne de stock ne porte plusieurs unités : le stock est déjà
          tenu pièce par pièce.
        </p>
      </div>
    )
  }

  return (
    <div className="devfix-report">
      <div className="ci-preview-summary">
        <div className="ci-summary-chip ci-summary-chip--total">
          <Boxes size={14} />
          <strong>{totals.lines}</strong> ligne{totals.lines !== 1 ? 's' : ''} multi-unités
        </div>
        <div className="ci-summary-chip">
          <CheckCircle2 size={14} />
          <strong>{totals.created}</strong> ligne{totals.created !== 1 ? 's' : ''}
          {dry ? ' à créer' : ' créée' + (totals.created !== 1 ? 's' : '')}
        </div>
      </div>

      <div className="ci-table-wrap">
        <table className="ci-preview-table">
          <thead>
            <tr>
              <th>Article</th>
              <th>Lot / n° de série</th>
              <th>Quantité</th>
              <th>{dry ? 'Lignes à créer' : 'Lignes créées'}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="ci-cell-name">{l.product}</td>
                <td>{l.lotNumber}</td>
                <td>{l.before}</td>
                <td>+{l.created}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * Repartir de zéro avec un fichier de parc.
 *
 * Le geste se fait dans l'écran d'import, ouvert en mode « remise à zéro » :
 * le fichier y est lu et analysé comme d'habitude, les regroupements de clients
 * et les modèles s'y décident, et la base n'est vidée qu'au dernier clic, dans
 * la même requête que l'import. Rien n'est perdu tant que ce clic n'a pas eu lieu.
 */
function ReimportCard() {
  const navigate = useNavigate()
  const [downloading, setDownloading] = useState(false)

  async function backup() {
    setDownloading(true)
    try {
      await downloadBackup()
      toast.success('Sauvegarde téléchargée.')
    } catch (err) {
      toast.error(err.message || 'Le téléchargement a échoué.')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="devfix-task devfix-task--danger">
      <div className="devfix-task-head">
        <span className="devfix-task-icon"><FileSpreadsheet size={16} /></span>
        <div>
          <h3 className="devfix-task-title">Repartir de zéro avec un fichier de parc</h3>
          <p className="devfix-task-desc">
            Vide toutes les données métier — clients, parc, contrats, planning, stock,
            catalogue, documents — puis importe le fichier Excel du parc. Les comptes
            utilisateurs et les paramètres de l'application sont conservés.
          </p>
        </div>
      </div>

      <p className="ci-legend">
        <Info size={12} /> 1. Téléchargez une sauvegarde : c'est elle qui permet de revenir en
        arrière. 2. Ouvrez l'import : lisez le fichier, vérifiez l'analyse et les clients à
        regrouper, puis tapez <strong>REINITIALISER</strong> — la base n'est vidée qu'à ce
        moment-là, juste avant l'import.
      </p>

      <div className="ci-action-row">
        <button className="btn btn--ghost" onClick={backup} disabled={downloading}>
          {downloading
            ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Préparation…</>
            : <><Download size={14} /> Télécharger une sauvegarde</>}
        </button>
        <button className="btn btn--danger" onClick={() => navigate('/clients/import?reset=1')}>
          <RotateCcw size={14} /> Ouvrir l'import en mode remise à zéro
        </button>
      </div>
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

      <ReimportCard />

      {tasks.length === 0 && !error
        ? <div className="sp-placeholder">
            <Wrench size={40} strokeWidth={1.2} />
            <p style={{ marginTop: 12 }}>Aucune reprise disponible.</p>
          </div>
        : tasks.map(t => <TaskCard key={t.id} task={t} />)}
    </>
  )
}
