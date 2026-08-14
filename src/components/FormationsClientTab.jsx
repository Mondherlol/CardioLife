import { useState, useEffect, useMemo } from 'react'
import { toast } from 'react-toastify'
import { GraduationCap, Plus } from 'lucide-react'
import { getFormationsByClient } from '../api/formations'
import { getUsers } from '../api/users'
import { stageOf } from '../lib/formations'
import { FormationRow, FormationsSummary } from './FormationRow'
import FormationModal from './FormationModal'

const FILTERS = [
  { id: 'toutes',    label: 'Toutes' },
  { id: 'programme', label: 'Programmées' },
  { id: 'termine',   label: 'À livrer' },
  { id: 'livre',     label: 'Livrées' },
]

/**
 * Formations d'un client, tous sites confondus. Même lecture que la fiche site :
 * l'aperçu en tête dit ce qui reste à faire, la liste détaille.
 */
export default function FormationsClientTab({ clientId, clientName }) {
  const [formations, setFormations] = useState([])
  const [users,      setUsers]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [filter,     setFilter]     = useState('toutes')
  const [modal,      setModal]      = useState(null)   // { mode, formation? }

  useEffect(() => {
    getFormationsByClient(clientId)
      .then(data => { setFormations(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [clientId])

  useEffect(() => {
    getUsers().then(data => setUsers(Array.isArray(data) ? data : [])).catch(() => {})
  }, [])

  function upsert(f) {
    setFormations(prev => prev.some(x => x._id === f._id)
      ? prev.map(x => (x._id === f._id ? f : x))
      : [f, ...prev])
  }

  const counts = useMemo(() => {
    const out = { toutes: formations.length, programme: 0, termine: 0, livre: 0 }
    formations.forEach(f => { out[stageOf(f).id] = (out[stageOf(f).id] || 0) + 1 })
    return out
  }, [formations])

  const visible = useMemo(() => {
    const list = filter === 'toutes' ? formations : formations.filter(f => stageOf(f).id === filter)
    return [...list].sort((a, b) => new Date(b.date) - new Date(a.date))
  }, [formations, filter])

  if (loading) return <div className="table-loading"><span className="spinner" /></div>

  return (
    <div className="sd-section">
      <div className="cd-tab-header">
        <div className="cd-tab-headline">
          <h3 className="cd-tab-title">Formations ({formations.length})</h3>
          <p className="cd-tab-hint">Chaque DAE posé ouvre droit à 16 places de formation.</p>
        </div>
        <button className="btn btn--primary btn--sm" onClick={() => setModal({ mode: 'create' })}>
          <Plus size={14} /> Nouvelle formation
        </button>
      </div>

      <FormationsSummary
        formations={formations}
        onPick={f => setModal({ mode: 'edit', formation: f })}
      />

      {formations.length > 0 && (
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
      )}

      {formations.length === 0 ? (
        <div className="cd-tab-empty">
          <GraduationCap size={38} color="var(--gray-300)" />
          <p>Aucune formation enregistrée pour ce client.</p>
          <button className="btn btn--primary btn--sm" onClick={() => setModal({ mode: 'create' })}>
            <Plus size={13} /> Programmer la première
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="cd-tab-empty">
          <GraduationCap size={38} color="var(--gray-300)" />
          <p>Aucune formation dans cette catégorie.</p>
        </div>
      ) : (
        <div className="sd-list">
          {visible.map(f => (
            <FormationRow key={f._id} formation={f}
              onClick={() => setModal({ mode: 'edit', formation: f })} />
          ))}
        </div>
      )}

      {modal && (
        <FormationModal
          mode={modal.mode}
          formation={modal.formation}
          presetClient={{ id: clientId, name: clientName }}
          users={users}
          onClose={() => setModal(null)}
          onSaved={f => { upsert(f); setModal(null) }}
          onChanged={upsert}
          onDeleted={id => {
            setFormations(prev => prev.filter(f => f._id !== id))
            setModal(null)
            toast.success('Formation supprimée.')
          }}
        />
      )}
    </div>
  )
}
