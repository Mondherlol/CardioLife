import { useState, useEffect } from 'react'
import { toast } from 'react-toastify'
import { GraduationCap, ExternalLink, Unlink, Calendar, Users, User, CheckCircle2, Link2, Trash2 } from 'lucide-react'
import { setFormationLink } from '../api/interventions'
import { getFormation, deleteFormation } from '../api/formations'
import { getUsers } from '../api/users'
import FormationModal from './FormationModal'
import FormationLinkFields, { emptyFormationLink, formationLinkError, applyFormationLink } from './FormationLinkFields'

const STATUS = {
  planifie: { label: 'Programmée', cls: 'fl-status--plan' },
  en_cours: { label: 'En cours',   cls: 'fl-status--plan' },
  fait:     { label: 'Réalisée',   cls: 'fl-status--done' },
  annule:   { label: 'Annulée',    cls: 'fl-status--off' },
}

const fmtDateTime = d => (d
  ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—')

/**
 * Onglet « Formation » de la fiche d'une visite : la séance qui l'accompagne.
 * On l'ouvre (sa fiche complète : agents, report, attestations), on la délie,
 * ou — s'il n'y en a pas — on en crée une ou on lie une existante.
 */
export default function LinkedFormationTab({ iv, canManage, onChanged, onRefresh }) {
  const f = iv.linkedFormation
  const [link,    setLink]    = useState(() => ({ ...emptyFormationLink(), enabled: true }))
  const [saving,  setSaving]  = useState(false)
  const [modal,   setModal]   = useState(null)    // formation peuplée, ouverte dans sa fiche
  const [users,   setUsers]   = useState([])

  useEffect(() => { getUsers().then(d => setUsers(Array.isArray(d) ? d : [])).catch(() => {}) }, [])

  async function associate() {
    const err = formationLinkError(link, true)
    if (err) { toast.error(err); return }
    setSaving(true)
    try {
      onChanged(await applyFormationLink(iv._id, link, true))
      toast.success('Formation liée à la visite.')
    } catch (e) {
      toast.error(e.message || 'Liaison impossible.')
    } finally {
      setSaving(false)
    }
  }

  async function unlink() {
    if (!window.confirm('Délier cette formation de la visite ? Elle reste dans le tableau des formations.')) return
    setSaving(true)
    try {
      onChanged(await setFormationLink(iv._id, { mode: 'none' }))
      toast.success('Formation déliée.')
    } catch (e) {
      toast.error(e.message || 'Impossible de délier.')
    } finally {
      setSaving(false)
    }
  }

  /* Supprimer : la séance disparaît du tableau des formations ; le serveur
     retire au passage le lien côté visite. */
  async function remove() {
    if (!window.confirm(`Supprimer la formation « ${f.title} » ? Elle sera déliée de la visite et effacée du tableau des formations.`)) return
    setSaving(true)
    try {
      await deleteFormation(f._id)
      toast.success('Formation supprimée.')
      await onRefresh()
    } catch (e) {
      toast.error(e.message || 'Suppression impossible.')
    } finally {
      setSaving(false)
    }
  }

  async function open() {
    try { setModal(await getFormation(f._id)) } catch (e) { toast.error(e.message) }
  }

  if (!f) {
    return (
      <div className="fiche-page-section" style={{ marginTop: 8 }}>
        <div className="fiche-page-section-title"><GraduationCap size={14} /> Formation des agents</div>
        <div className="fiche-page-body">
          <p className="form-hint" style={{ marginTop: 0 }}>Aucune formation n'accompagne cette visite.</p>
          {canManage && (
            <>
              <FormationLinkFields siteId={iv.site?._id || iv.site} value={link} onChange={setLink} alwaysOn />
              <button className="btn btn--primary" onClick={associate} disabled={saving} style={{ marginTop: 10 }}>
                {saving ? <span className="spinner spinner--sm" /> : <Link2 size={14} />} Associer la formation
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  const st = STATUS[f.status] || STATUS.planifie
  return (
    <div className="fiche-page-section" style={{ marginTop: 8 }}>
      <div className="fiche-page-section-title"><GraduationCap size={14} /> Formation des agents</div>
      <div className="fiche-page-body">
        <div className="fl-card">
          <div className="fl-card-head">
            <strong className="fl-card-title">{f.title}</strong>
            <span className={`fl-status ${st.cls}`}>{st.label}</span>
          </div>
          <div className="fl-card-meta">
            <span><Calendar size={13} /> {fmtDateTime(f.date)}</span>
            <span><Users size={13} /> {f.aFormer || 0} à former</span>
            <span><CheckCircle2 size={13} /> {f.formes ?? '—'} formé{(f.formes || 0) > 1 ? 's' : ''}</span>
            {f.assignedTo?.length > 0 && (
              <span><User size={13} /> {f.assignedTo.map(u => u.fullName || u.username).join(', ')}</span>
            )}
          </div>
          {f.hasList && <p className="form-hint">Liste nominative : les agents se gèrent sur la fiche formation.</p>}
          <div className="fl-card-actions">
            <button className="btn btn--ghost btn--sm" onClick={open}>
              <ExternalLink size={13} /> Ouvrir la fiche formation (agents, report, attestations)
            </button>
            {canManage && (
              <button className="btn btn--ghost btn--sm" onClick={unlink} disabled={saving}>
                <Unlink size={13} /> Délier
              </button>
            )}
            {canManage && (
              <button className="btn btn--ghost btn--sm fiche-delete-btn" onClick={remove} disabled={saving}>
                <Trash2 size={13} /> Supprimer
              </button>
            )}
          </div>
        </div>
      </div>

      {modal && (
        <FormationModal
          mode="edit"
          formation={modal}
          users={users}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); onRefresh() }}
          onDeleted={() => { setModal(null); onRefresh() }}
          onChanged={() => onRefresh()}
        />
      )}
    </div>
  )
}
