import { useState, useEffect, useMemo } from 'react'
import { toast } from 'react-toastify'
import {
  GraduationCap, Plus, Search, X, Send, CalendarDays, Users, Mail, AlertTriangle,
} from 'lucide-react'
import { getAllFormations } from '../api/formations'
import { getUsers } from '../api/users'
import { useLoadingBar } from '../hooks/useLoadingBar'
import { stageOf, countParticipants, attestationRecipient, fmtFormationDate } from '../lib/formations'
import { FormationRow } from '../components/FormationRow'
import FormationModal from '../components/FormationModal'

const FILTERS = [
  { id: 'a_traiter', label: 'À traiter' },
  { id: 'programme', label: 'Programmées' },
  { id: 'termine',   label: 'À livrer' },
  { id: 'livre',     label: 'Livrées' },
  { id: 'toutes',    label: 'Toutes' },
]

/**
 * Toutes les formations, tous clients confondus — le poste de travail de
 * l'assistante. La vue s'ouvre sur ce qui demande une action : les séances à
 * venir et les attestations qui attendent leur envoi.
 */
export default function FormationsPage({ embedded = false }) {
  const [formations, setFormations] = useState([])
  const [users,      setUsers]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [search,     setSearch]     = useState('')
  const [filter,     setFilter]     = useState('a_traiter')
  const [modal,      setModal]      = useState(null)

  useLoadingBar(loading)

  useEffect(() => {
    getAllFormations()
      .then(data => { setFormations(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(err => { toast.error(err.message || 'Chargement impossible.'); setLoading(false) })
  }, [])

  useEffect(() => {
    getUsers().then(d => setUsers(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  function upsert(f) {
    setFormations(prev => prev.some(x => x._id === f._id)
      ? prev.map(x => (x._id === f._id ? f : x))
      : [f, ...prev])
  }

  const counts = useMemo(() => {
    const out = { toutes: formations.length, programme: 0, termine: 0, livre: 0, annule: 0 }
    formations.forEach(f => { const s = stageOf(f).id; out[s] = (out[s] || 0) + 1 })
    out.a_traiter = out.programme + out.termine
    return out
  }, [formations])

  /* Agents encore à former, toutes séances confondues : c'est la file d'attente
     réelle du terrain, elle ne se voit nulle part ailleurs. */
  const toTrain = useMemo(() => formations.reduce((n, f) => (
    stageOf(f).id === 'annule' ? n : n + countParticipants(f).a_former
  ), 0), [formations])

  const visible = useMemo(() => {
    let list = formations
    if (filter === 'a_traiter') list = list.filter(f => ['programme', 'termine'].includes(stageOf(f).id))
    else if (filter !== 'toutes') list = list.filter(f => stageOf(f).id === filter)

    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(f =>
        f.title?.toLowerCase().includes(q) ||
        f.clientName?.toLowerCase().includes(q) ||
        (f.site?.name || f.siteName || '').toLowerCase().includes(q) ||
        (f.participants || []).some(p => p.name?.toLowerCase().includes(q)) ||
        (f.attestationContact?.name || '').toLowerCase().includes(q)
      )
    }

    // À traiter : les attestations en attente d'abord, puis les séances à venir.
    const rank = { termine: 0, programme: 1, livre: 2, annule: 3 }
    return [...list].sort((a, b) => {
      const ra = rank[stageOf(a).id], rb = rank[stageOf(b).id]
      if (ra !== rb) return ra - rb
      return stageOf(a).id === 'programme'
        ? new Date(a.date) - new Date(b.date)
        : new Date(b.date) - new Date(a.date)
    })
  }, [formations, filter, search])

  const toDeliver = useMemo(
    () => formations.filter(f => stageOf(f).id === 'termine'),
    [formations])

  if (loading) {
    return (
      <div className={embedded ? 'mt-tab-panel' : 'page-content'}>
        <div className="table-loading"><span className="spinner" /></div>
      </div>
    )
  }

  return (
    <div className={embedded ? 'mt-tab-panel' : 'page-content'}>
      <div className="page-header">
        <div>
          {!embedded && <h1 className="page-title"><GraduationCap size={20} /> Formations</h1>}
          <p className="page-subtitle">
            {formations.length} formation{formations.length !== 1 ? 's' : ''}
            {counts.termine > 0 && ` · ${counts.termine} attestation${counts.termine !== 1 ? 's' : ''} à livrer`}
            {toTrain > 0 && ` · ${toTrain} agent${toTrain !== 1 ? 's' : ''} à former`}
          </p>
        </div>
        <button className="btn btn--primary" onClick={() => setModal({ mode: 'create' })}>
          <Plus size={14} /> Nouvelle formation
        </button>
      </div>

      {/* Ce qui attend un envoi : la file de travail de l'assistante. */}
      {toDeliver.length > 0 && filter !== 'livre' && (
        <div className="fm-deliver">
          <div className="fm-deliver-head">
            <Send size={14} />
            <strong>{toDeliver.length} attestation{toDeliver.length > 1 ? 's' : ''} à envoyer</strong>
            <span>Séances terminées dont les documents n'ont pas encore été livrés.</span>
          </div>
          <div className="fm-deliver-list">
            {toDeliver.slice(0, 4).map(f => {
              const to = attestationRecipient(f)
              return (
                <button key={f._id} type="button" className="fm-deliver-card"
                  onClick={() => setModal({ mode: 'edit', formation: f })}>
                  <span className="fm-deliver-client">{f.clientName || '—'}</span>
                  <span className="fm-deliver-title">{f.title}</span>
                  <span className="fm-deliver-meta">
                    <CalendarDays size={10} /> {fmtFormationDate(f.date)}
                    {countParticipants(f).total > 0 && (
                      <> · <Users size={10} /> {countParticipants(f).forme} formé{countParticipants(f).forme > 1 ? 's' : ''}</>
                    )}
                  </span>
                  <span className={`fm-deliver-to${to?.email ? '' : ' fm-deliver-to--missing'}`}>
                    {to?.email
                      ? <><Mail size={10} /> {to.email}</>
                      : <><AlertTriangle size={10} /> destinataire à renseigner</>}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="table-toolbar">
        <div className="search-wrap">
          <Search size={14} className="search-icon" />
          <input className="search-input" value={search}
            placeholder="Client, site, intitulé, agent formé…"
            onChange={e => setSearch(e.target.value)} />
          {search && <button className="search-clear" onClick={() => setSearch('')}><X size={13} /></button>}
        </div>
        <div className="rep-tabs">
          {FILTERS.map(t => (
            <button key={t.id} type="button"
              className={`rep-tab${filter === t.id ? ' rep-tab--on' : ''}`}
              onClick={() => setFilter(t.id)}>
              {t.label}
              {counts[t.id] > 0 && <span className="rep-tab-count">{counts[t.id]}</span>}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="cd-tab-empty">
          <GraduationCap size={40} color="var(--gray-300)" />
          <p>
            {search ? `Aucune formation ne correspond à « ${search} ».`
              : filter === 'a_traiter' ? 'Rien en attente — toutes les formations sont livrées.'
              : 'Aucune formation dans cette catégorie.'}
          </p>
          {formations.length === 0 && (
            <button className="btn btn--primary btn--sm" onClick={() => setModal({ mode: 'create' })}>
              <Plus size={13} /> Programmer la première
            </button>
          )}
        </div>
      ) : (
        <div className="sd-list">
          {visible.map(f => (
            <FormationRow key={f._id} formation={f} showClient
              onClick={() => setModal({ mode: 'edit', formation: f })} />
          ))}
        </div>
      )}

      {modal && (
        <FormationModal
          mode={modal.mode}
          formation={modal.formation}
          users={users}
          onClose={() => setModal(null)}
          onSaved={f => { upsert(f); setModal(null) }}
          onChanged={upsert}
          onDeleted={id => {
            setFormations(prev => prev.filter(f => f._id !== id))
            setModal(null)
          }}
        />
      )}
    </div>
  )
}
