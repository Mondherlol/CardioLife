import { useState, useEffect } from 'react'
import { toast } from 'react-toastify'
import {
  GraduationCap, Plus, FileText, Calendar,
  Trash2, Check, History, CheckCircle2, Circle,
} from 'lucide-react'
import {
  getFormationsByClient, deleteFormation, toggleAttestation,
} from '../api/formations'
import { getUsers } from '../api/users'
import EventModal from './EventModal'

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}

/* ─── Main tab ──────────────────────────────────────────────── */
export default function FormationsClientTab({ clientId, clientName }) {
  const [formations, setFormations] = useState([])
  const [users,      setUsers]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [modal,      setModal]      = useState(null)   // { mode, entity? }

  useEffect(() => {
    getFormationsByClient(clientId)
      .then(data => { setFormations(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [clientId])

  useEffect(() => {
    getUsers().then(data => setUsers(Array.isArray(data) ? data : [])).catch(() => {})
  }, [])

  function update(updated) {
    setFormations(prev => prev.map(f => f._id === updated._id ? updated : f))
  }

  async function handleToggleAttestation(id) {
    try {
      const updated = await toggleAttestation(id)
      update(updated)
    } catch { toast.error("Erreur lors de la mise à jour de l'attestation.") }
  }

  async function handleDelete(id, e) {
    e.stopPropagation()
    if (!window.confirm('Supprimer cette formation ? Cette action est irréversible.')) return
    try {
      await deleteFormation(id)
      setFormations(prev => prev.filter(f => f._id !== id))
      toast.success('Formation supprimée.')
    } catch { toast.error('Erreur lors de la suppression.') }
  }

  function handleCreated(f) {
    setFormations(prev => [f, ...prev])
    setModal(null)
  }

  function handleSaved(f) {
    update(f)
    setModal(null)
  }

  if (loading) return <div className="table-loading"><span className="spinner" /></div>

  return (
    <div className="fmn-tab">
      <div className="fmn-tab-bar">
        <span className="fmn-tab-count">
          {formations.length} formation{formations.length !== 1 ? 's' : ''}
        </span>
        <button className="btn btn--primary btn--sm" onClick={() => setModal({ mode: 'create' })}>
          <Plus size={14} /> Nouvelle formation
        </button>
      </div>

      {formations.length === 0 ? (
        <div className="cd-tab-empty">
          <GraduationCap size={40} color="var(--gray-300)" />
          <p>Aucune formation enregistrée pour ce client.</p>
        </div>
      ) : (
        <div className="fmn-list">
          {formations.map(f => (
            <div
              key={f._id}
              className={`fmn-card ${f.attestationDelivered ? 'fmn-card--done' : ''}`}
              onClick={() => setModal({ mode: 'edit', entity: f })}
            >
              {/* Attestation toggle — stopPropagation pour ne pas ouvrir la modal */}
              <button
                className={`fmn-attest-btn ${f.attestationDelivered ? 'fmn-attest-btn--done' : ''}`}
                onClick={e => { e.stopPropagation(); handleToggleAttestation(f._id) }}
                title={f.attestationDelivered ? 'Retirer la livraison des attestations' : 'Marquer les attestations comme livrées'}
              >
                {f.attestationDelivered
                  ? <CheckCircle2 size={18} />
                  : <Circle size={18} />}
              </button>

              <div className="fmn-card-body-row">
                <div className="fmn-title-group">
                  <span className="fmn-title">{f.title}</span>
                  <span className="fmn-date"><Calendar size={11} /> {fmtDate(f.date)}</span>
                </div>

                <div className="fmn-card-chips">
                  {f.attestationDelivered ? (
                    <span className="fmn-chip fmn-chip--done">
                      <Check size={10} strokeWidth={3} /> Attestations livrées
                    </span>
                  ) : (
                    <span className="fmn-chip fmn-chip--pending">En attente</span>
                  )}
                  <span className="fmn-chip fmn-chip--neutral">
                    <FileText size={10} /> {f.documents.length} doc{f.documents.length !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>

              <div className="fmn-card-actions">
                <button
                  className="fmn-icon-btn fmn-icon-btn--history"
                  onClick={e => { e.stopPropagation(); setModal({ mode: 'edit', entity: f }) }}
                  title="Voir les détails / historique"
                >
                  <History size={14} />
                </button>
                <button
                  className="fmn-icon-btn fmn-icon-btn--delete"
                  onClick={e => handleDelete(f._id, e)}
                  title="Supprimer"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <EventModal
          mode={modal.mode}
          entity={modal.entity}
          entityKind="formation"
          lockType="formation"
          presetClient={{ id: clientId, name: clientName }}
          users={users}
          onClose={() => setModal(null)}
          onSaved={modal.mode === 'create' ? handleCreated : handleSaved}
          onChanged={update}
          onDeleted={id => { setFormations(prev => prev.filter(f => f._id !== id)); setModal(null) }}
        />
      )}
    </div>
  )
}
