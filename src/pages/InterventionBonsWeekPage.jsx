import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ChevronLeft, ChevronRight, Printer, Save, Hash, ExternalLink, CheckSquare, Square,
} from 'lucide-react'
import { toast } from 'react-toastify'
import { getInterventions, getIntervention, saveBon } from '../api/interventions'
import { getAppSettings } from '../api/appSettings'
import { localDateStr } from '../lib/appointmentConstants'
import { loadDraft, syncDraft } from '../lib/bonDraft'
import { bonPdfBlob, printBlob } from '../lib/bonPdf'
import {
  BonDocument, BonFields, FALLBACK_COMPANY, bonLines, bonPayload, initialBon,
} from './InterventionBonPage'

/** Lundi de la semaine de `d`, à minuit. */
function mondayOf(d) {
  const m = new Date(d)
  m.setHours(0, 0, 0, 0)
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7))
  return m
}

const fmtDay = d => new Date(d).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' })

const TYPE_LABELS = {
  semestriel: 'Semestriel', annuel: 'Annuel', hors_contrat: 'Hors contrat', intervention: 'Intervention',
}

const techOf = iv => iv.technicienName || iv.technicien?.fullName || ''

/**
 * « 781/2026 » → numéro 781, suffixe « /2026 ». Le numéro est la première
 * suite de chiffres ; le reste (préfixe, année) est recopié tel quel.
 */
function parseRef(ref) {
  const m = String(ref || '').trim().match(/^(\D*)(\d+)(.*)$/)
  if (!m) return null
  return { prefix: m[1], n: Number(m[2]), width: m[2].length, suffix: m[3] }
}
const formatRef = (p, n) => `${p.prefix}${String(n).padStart(p.width, '0')}${p.suffix}`

/**
 * Bons d'intervention de la semaine : préparer et imprimer d'un coup ceux de
 * la tournée.
 *
 * Chaque bon se règle comme sur sa propre page — référence, BC, natures,
 * signataire, désignations — et s'enregistre sur la visite : il ressortira
 * identique depuis la fiche. La numérotation se donne en une fois, à partir
 * du prochain numéro du carnet.
 *
 * `?semaine=AAAA-MM-JJ` : n'importe quel jour de la semaine voulue.
 */
export default function InterventionBonsWeekPage() {
  const [params, setParams] = useSearchParams()
  const monday = useMemo(
    () => mondayOf(params.get('semaine') ? new Date(`${params.get('semaine')}T12:00`) : new Date()),
    [params])
  const sunday = useMemo(() => {
    const s = new Date(monday); s.setDate(s.getDate() + 6); s.setHours(23, 59, 59, 999); return s
  }, [monday])

  const [items,    setItems]    = useState(null)   // interventions détaillées
  const [error,    setError]    = useState('')
  const [company,  setCompany]  = useState(FALLBACK_COMPANY)
  const [tech,     setTech]     = useState('')
  // Réglages de chaque bon, et leur version enregistrée (pour savoir quoi sauver).
  const [bons,     setBons]     = useState({})
  const [savedBons, setSavedBons] = useState({})
  // Visites décochées : listées, mais ni imprimées ni numérotées.
  const [excluded, setExcluded] = useState(() => new Set())
  const [selected, setSelected] = useState(null)
  const [startRef, setStartRef] = useState('')
  const [saving,   setSaving]   = useState(false)

  useEffect(() => {
    getAppSettings()
      .then(s => s?.company && setCompany({ ...FALLBACK_COMPANY, ...s.company }))
      .catch(() => {})
  }, [])

  useEffect(() => {
    let alive = true
    setItems(null)
    setError('')
    setExcluded(new Set())
    getInterventions({ from: monday.toISOString(), to: sunday.toISOString() })
      .then(list => Promise.all((Array.isArray(list) ? list : [])
        // Le détail porte le parc du site : sans lui, le bon ne nomme pas les DAE.
        .map(iv => getIntervention(iv._id).catch(() => iv))))
      .then(full => {
        if (!alive) return
        const sorted = full.sort((a, b) =>
          new Date(a.scheduledDate) - new Date(b.scheduledDate)
          || String(a.clientName || '').localeCompare(String(b.clientName || '')))
        const init = Object.fromEntries(sorted.map(iv => [iv._id, initialBon(iv)]))
        /* Onglet déchargé puis rechargé : chaque bon reprend sa saisie en cours. */
        const drafts = Object.fromEntries(sorted.map(iv => [iv._id, loadDraft('intervention', iv._id) || init[iv._id]]))
        const restored = sorted.filter(iv => drafts[iv._id] !== init[iv._id]).length
        setItems(sorted)
        setBons(drafts)
        setSavedBons(init)
        if (restored) {
          toast.info(`${restored} bon${restored > 1 ? 's' : ''} : modifications non enregistrées restaurées.`)
        }
        setSelected(sorted[0]?._id || null)
      })
      .catch(err => { if (alive) setError(err.message || 'Chargement impossible.') })
    return () => { alive = false }
  }, [monday, sunday])

  useEffect(() => {
    document.title = `Bons d'intervention — semaine du ${monday.toLocaleDateString('fr-FR')}`
  }, [monday])

  const techs = useMemo(
    () => [...new Set((items || []).map(techOf).filter(Boolean))].sort(),
    [items])

  const visible = useMemo(
    () => (items || []).filter(iv => !tech || techOf(iv) === tech),
    [items, tech])
  const printed = visible.filter(iv => !excluded.has(iv._id))

  const isDirty = useCallback(
    id => JSON.stringify(bons[id]) !== JSON.stringify(savedBons[id]),
    [bons, savedBons])
  const dirtyIds = (items || []).map(iv => iv._id).filter(isDirty)

  // Brouillon local de chaque bon, effacé dès qu'il est enregistré.
  useEffect(() => {
    Object.keys(bons).forEach(id => syncDraft('intervention', id, bons[id], savedBons[id]))
  }, [bons, savedBons])

  // Modifications non enregistrées : on prévient avant de quitter la page.
  useEffect(() => {
    if (!dirtyIds.length) return
    const warn = e => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirtyIds.length])

  // Le bon ouvert reste dans la liste filtrée.
  useEffect(() => {
    if (visible.length && !visible.some(iv => iv._id === selected)) setSelected(visible[0]._id)
  }, [visible, selected])

  const current = visible.find(iv => iv._id === selected) || null
  const currentIdx = current ? visible.indexOf(current) : -1

  function shiftWeek(n) {
    if (dirtyIds.length && !window.confirm('Des bons ne sont pas enregistrés. Changer de semaine quand même ?')) return
    const d = new Date(monday); d.setDate(d.getDate() + 7 * n)
    setParams({ semaine: localDateStr(d) })
  }

  function toggle(id) {
    setExcluded(cur => {
      const next = new Set(cur)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    const allOn = visible.every(iv => !excluded.has(iv._id))
    setExcluded(cur => {
      const next = new Set(cur)
      visible.forEach(iv => (allOn ? next.add(iv._id) : next.delete(iv._id)))
      return next
    })
  }

  const setBon = id => updater => setBons(cur => ({
    ...cur,
    [id]: typeof updater === 'function' ? updater(cur[id]) : updater,
  }))

  /* Numérotation du carnet : les bons cochés sans référence reçoivent la
     suite, dans l'ordre de la tournée. Une référence déjà saisie n'est pas
     touchée — elle figure peut-être déjà sur un papier signé. */
  function numberRefs() {
    const p = parseRef(startRef)
    if (!p) { toast.error('Indiquez le premier numéro, par exemple 781/2026.'); return }
    const targets = printed.filter(iv => !String(bons[iv._id]?.ref || '').trim())
    if (!targets.length) { toast.info('Tous les bons cochés ont déjà une référence.'); return }
    setBons(cur => {
      const next = { ...cur }
      targets.forEach((iv, i) => { next[iv._id] = { ...next[iv._id], ref: formatRef(p, p.n + i) } })
      return next
    })
    setStartRef(formatRef(p, p.n + targets.length))
    toast.success(`${targets.length} référence${targets.length > 1 ? 's' : ''} attribuée${targets.length > 1 ? 's' : ''} — pensez à enregistrer.`)
  }

  async function saveIds(ids) {
    if (!ids.length) return true
    setSaving(true)
    const byId = Object.fromEntries((items || []).map(iv => [iv._id, iv]))
    const results = await Promise.allSettled(ids.map(id => {
      const lines = bonLines(byId[id], bons[id].natures, bons[id].custom)
      return saveBon(id, bonPayload(bons[id], lines)).then(() => id)
    }))
    const ok = results.filter(r => r.status === 'fulfilled').map(r => r.value)
    setSavedBons(cur => {
      const next = { ...cur }
      ok.forEach(id => { next[id] = bons[id] })
      return next
    })
    setSaving(false)
    const failed = ids.length - ok.length
    if (failed) toast.error(`${failed} bon${failed > 1 ? 's' : ''} non enregistré${failed > 1 ? 's' : ''}.`)
    else toast.success(ok.length > 1 ? `${ok.length} bons enregistrés.` : 'Bon enregistré.')
    return !failed
  }

  /* On imprime ce qui sera conservé : les retouches sont enregistrées avant,
     sans quoi le bon signé dirait autre chose que la fiche. */
  async function print() {
    const pending = printed.map(iv => iv._id).filter(isDirty)
    if (pending.length && !(await saveIds(pending))) {
      if (!window.confirm("Certains bons n'ont pas pu être enregistrés. Imprimer quand même ?")) return
    }
    /* Même PDF que le bouton « Télécharger » d'un bon : un bon imprimé d'ici
       est identique à celui imprimé depuis sa page ou depuis le fichier. */
    const pages = [...document.querySelectorAll('.bw-print .bi-page')]
    if (!pages.length) return
    setSaving(true)
    try {
      printBlob(await bonPdfBlob(pages))
    } catch {
      window.print()
    } finally {
      setSaving(false)
    }
  }

  const allOn = visible.length > 0 && visible.every(iv => !excluded.has(iv._id))
  const missingRefs = printed.filter(iv => !String(bons[iv._id]?.ref || '').trim()).length

  return (
    <div className="bw-wrap">
      {/* ── Barre de commande ── */}
      <header className="bw-top no-print">
        <div className="bw-week">
          <button className="btn btn--ghost btn--sm" onClick={() => shiftWeek(-1)} title="Semaine précédente">
            <ChevronLeft size={16} />
          </button>
          <div className="bw-week-label">
            <span className="bw-week-title">Bons d'intervention</span>
            <span className="bw-week-range">
              Semaine du {monday.toLocaleDateString('fr-FR')} au {sunday.toLocaleDateString('fr-FR')}
            </span>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={() => shiftWeek(1)} title="Semaine suivante">
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="bw-top-tools">
          {techs.length > 1 && (
            <select className="form-input form-input--plain bw-tech" value={tech}
              onChange={e => setTech(e.target.value)} title="Technicien">
              <option value="">Tous les techniciens</option>
              {techs.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}

          <div className="bw-numbering" title="Attribue la suite aux bons cochés qui n'ont pas encore de référence">
            <Hash size={14} />
            <input className="form-input form-input--plain" value={startRef}
              onChange={e => setStartRef(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && numberRefs()}
              placeholder="1er n° (781/2026)" />
            <button className="btn btn--ghost btn--sm" onClick={numberRefs} disabled={!startRef.trim()}>
              Numéroter{missingRefs ? ` (${missingRefs})` : ''}
            </button>
          </div>

          <button className="btn btn--ghost" onClick={() => saveIds(dirtyIds)}
            disabled={saving || !dirtyIds.length}>
            {saving ? <span className="login-btn-spinner" /> : <Save size={14} />}
            Enregistrer{dirtyIds.length ? ` (${dirtyIds.length})` : ''}
          </button>
          <button className="btn btn--primary" onClick={print} disabled={!printed.length || saving}>
            <Printer size={14} /> Imprimer {printed.length} bon{printed.length > 1 ? 's' : ''}
          </button>
        </div>
      </header>

      {error ? (
        <div className="bw-empty no-print">{error}</div>
      ) : items === null ? (
        <div className="bw-empty no-print"><span className="spinner" /> Chargement des visites…</div>
      ) : visible.length === 0 ? (
        <div className="bw-empty no-print">Aucune visite planifiée cette semaine.</div>
      ) : (
        <div className="bw-body no-print">
          {/* ── Liste des visites ── */}
          <aside className="bw-list">
            <button type="button" className="bw-list-head" onClick={toggleAll}>
              {allOn ? <CheckSquare size={15} /> : <Square size={15} />}
              {printed.length}/{visible.length} à imprimer
            </button>
            {visible.map(iv => {
              const on    = !excluded.has(iv._id)
              const ref   = String(bons[iv._id]?.ref || '').trim()
              const dirty = isDirty(iv._id)
              return (
                <div key={iv._id}
                  className={`bw-item${iv._id === selected ? ' bw-item--active' : ''}${on ? '' : ' bw-item--off'}`}
                  onClick={() => setSelected(iv._id)}>
                  <input type="checkbox" checked={on}
                    onClick={e => e.stopPropagation()}
                    onChange={() => toggle(iv._id)} />
                  <div className="bw-item-main">
                    <div className="bw-item-top">
                      <span className="bw-item-day">{fmtDay(iv.scheduledDate)}</span>
                      <span className={`ct-type-badge ct-type-badge--${iv.controlType === 'intervention' ? 'intervention' : iv.controlType === 'hors_contrat' ? 'hors' : iv.controlType}`}>
                        {TYPE_LABELS[iv.controlType] || 'Contrôle'}
                      </span>
                      {dirty && <span className="bw-dirty" title="Modifications non enregistrées" />}
                    </div>
                    <div className="bw-item-client">{iv.clientName || '—'}</div>
                    {(iv.objet || (iv.siteName && iv.siteName !== iv.clientName)) && (
                      <div className="bw-item-sub">{iv.objet || iv.siteName}</div>
                    )}
                    <div className="bw-item-meta">
                      {ref
                        ? <span className="bw-ref">N° {ref}</span>
                        : <span className="bw-ref bw-ref--missing">Sans référence</span>}
                      {techOf(iv) && <span className="bw-item-tech">{techOf(iv)}</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </aside>

          {/* ── Bon sélectionné : réglages puis aperçu ── */}
          {current && bons[current._id] && (() => {
            const value = bons[current._id]
            const lines = bonLines(current, value.natures, value.custom)
            return (
              <section className="bw-editor">
                <div className="bw-editor-head">
                  <button className="btn btn--ghost btn--sm" disabled={currentIdx <= 0}
                    onClick={() => setSelected(visible[currentIdx - 1]._id)} title="Bon précédent">
                    <ChevronLeft size={15} />
                  </button>
                  <div className="bw-editor-title">
                    <strong>{current.clientName || '—'}</strong>
                    <span>Bon {currentIdx + 1} sur {visible.length} · {fmtDay(current.scheduledDate)}</span>
                  </div>
                  <button className="btn btn--ghost btn--sm" disabled={currentIdx >= visible.length - 1}
                    onClick={() => setSelected(visible[currentIdx + 1]._id)} title="Bon suivant">
                    <ChevronRight size={15} />
                  </button>
                  <div className="bw-editor-actions">
                    <a className="btn btn--ghost btn--sm" href={`/interventions/${current._id}`}
                      target="_blank" rel="noreferrer" title="Ouvrir la fiche de la visite">
                      <ExternalLink size={13} /> Fiche
                    </a>
                    <button className="btn btn--ghost btn--sm"
                      disabled={saving || !isDirty(current._id)}
                      onClick={() => saveIds([current._id])}>
                      <Save size={13} /> Enregistrer ce bon
                    </button>
                  </div>
                </div>

                <div className="bi-bar bw-fields">
                  <BonFields value={value} onChange={setBon(current._id)} lines={lines} />
                </div>

                <div className="bw-preview">
                  <BonDocument iv={current} company={company} reference={value.ref}
                    bc={value.bc} signer={value.signer} lines={lines} />
                </div>
              </section>
            )
          })()}
        </div>
      )}

      {/* ── Ce qui part à l'impression : tous les bons cochés ── */}
      <div className="bw-print">
        {printed.map(iv => {
          const value = bons[iv._id]
          if (!value) return null
          return (
            <div key={iv._id} className="bi-week-page">
              <BonDocument iv={iv} company={company} reference={value.ref} bc={value.bc}
                signer={value.signer} lines={bonLines(iv, value.natures, value.custom)} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
