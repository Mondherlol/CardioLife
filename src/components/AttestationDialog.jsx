import { useState } from 'react'
import { toast } from 'react-toastify'
import { Award, X, UserPlus, Trash2, Download, Paperclip } from 'lucide-react'
import { CIVILITIES, attestationsPdfBlob, fmtAttestationDate } from '../lib/attestationPdf'
import { downloadBlob } from '../lib/bonPdf'

/**
 * Génération des attestations depuis la fiche formation.
 *
 * Les agents formés sont cochés d'office (à défaut, tous les présents) ; seule
 * la civilité reste à choisir, le modèle n'imprimant que « Mme » ou « Mr ».
 * Le DAE, le formateur et la date sont repris de la séance et restent
 * modifiables.
 *
 * Props :
 *  participants  liste nominative de la formation
 *  onCivility    (index, civilité) — reporte le choix sur la fiche, enregistré avec elle
 *  devices       modèles de DAE posés sur le site formé
 *  trainer       nom du premier formateur
 *  date          date de la séance (aaaa-mm-jj)
 *  fileLabel     suffixe du nom de fichier (client, date)
 *  onAttach      (blob, filename) => Promise — absent en création
 */
export default function AttestationDialog({
  participants = [], onCivility, devices = [], trainer = '', date = '', fileLabel = '', onAttach, onClose,
}) {
  const [people, setPeople] = useState(() => {
    const named   = participants.map((p, src) => ({ ...p, src })).filter(p => p.name?.trim())
    const trained = named.some(p => p.status === 'forme')
    return named.map(p => ({
      src:      p.src,
      name:     p.name.trim(),
      civility: p.civility || 'Mme',
      checked:  trained ? p.status === 'forme' : p.status !== 'absent',
    }))
  })
  const [device,  setDevice]  = useState(devices[0] || '')
  const [who,     setWho]     = useState(trainer)
  const [day,     setDay]     = useState(date)
  const [busy,    setBusy]    = useState('')

  const selected = people.filter(p => p.checked && p.name.trim())

  function setAt(i, patch) {
    setPeople(list => list.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  }

  async function generate(kind) {
    if (!selected.length) return toast.warn('Sélectionnez au moins une personne.')
    setBusy(kind)
    try {
      const blob = await attestationsPdfBlob(
        selected.map(p => ({ civility: p.civility, name: p.name.trim() })),
        { device: device.trim(), trainer: who.trim(), date: fmtAttestationDate(day) },
      )
      const filename = selected.length === 1
        ? `Attestation - ${selected[0].name.trim()}.pdf`
        : `Attestations${fileLabel ? ` - ${fileLabel}` : ''}.pdf`
      if (kind === 'attach') {
        await onAttach(blob, filename)
      } else {
        downloadBlob(blob, filename)
      }
    } catch (err) {
      toast.error(err.message || 'Erreur lors de la génération des attestations.')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="modal-overlay att-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="pmodal-header-icon" style={{ background: '#acb934' }}>
              <Award size={15} color="#fff" />
            </div>
            <div>
              <h2 className="modal-title">Attestations</h2>
              <p className="modal-subtitle">Une page par personne, d'après le modèle CardioLife</p>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-body fm-body">
          <div className="fm-block">
            <div className="fm-block-head">
              <span className="fm-block-title">Personnes ({selected.length} / {people.length})</span>
              {people.length > 0 && (
                <button type="button" className="fm-linkbtn"
                  onClick={() => {
                    const all = people.every(p => p.checked)
                    setPeople(list => list.map(p => ({ ...p, checked: !all })))
                  }}>
                  {people.every(p => p.checked) ? 'Tout décocher' : 'Tout cocher'}
                </button>
              )}
            </div>

            {people.length === 0 && (
              <p className="fm-hint">Aucun agent nommé sur cette formation : ajoutez les noms ci-dessous.</p>
            )}

            <div className="att-people">
              {people.map((p, i) => (
                <div key={i} className={`att-person${p.checked ? '' : ' att-person--off'}`}>
                  <input type="checkbox" checked={p.checked}
                    onChange={e => setAt(i, { checked: e.target.checked })} />
                  <div className="att-civ">
                    {CIVILITIES.map(c => (
                      <button key={c} type="button"
                        className={`att-civ-btn${p.civility === c ? ' att-civ-btn--on' : ''}`}
                        onClick={() => {
                          setAt(i, { civility: c })
                          if (p.src != null) onCivility?.(p.src, c)
                        }}>
                        {c}
                      </button>
                    ))}
                  </div>
                  <input className="form-input form-input--plain" value={p.name} placeholder="Nom et prénom"
                    onChange={e => setAt(i, { name: e.target.value })} />
                  <button type="button" className="fmn-icon-btn fmn-icon-btn--delete" title="Retirer"
                    onClick={() => setPeople(list => list.filter((_, idx) => idx !== i))}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>

            <button type="button" className="btn btn--ghost btn--sm" style={{ alignSelf: 'flex-start' }}
              onClick={() => setPeople(list => [...list, { name: '', civility: 'Mme', checked: true }])}>
              <UserPlus size={13} /> Ajouter une personne
            </button>
          </div>

          <div className="form-group">
            <label className="form-label">Défibrillateur cardiaque</label>
            <input className="form-input form-input--plain" value={device} list="att-devices"
              onChange={e => setDevice(e.target.value)} placeholder="ex. POWERHEART G3 Elite" />
            <datalist id="att-devices">
              {devices.map(d => <option key={d} value={d} />)}
            </datalist>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Formateur</label>
              <input className="form-input form-input--plain" value={who}
                onChange={e => setWho(e.target.value)} placeholder="Nom du formateur" />
            </div>
            <div className="form-group">
              <label className="form-label">Date</label>
              <input className="form-input form-input--plain" type="date" value={day}
                onChange={e => setDay(e.target.value)} />
            </div>
          </div>

          <div className="modal-footer" style={{ paddingTop: 0 }}>
            <div style={{ flex: 1 }} />
            {onAttach && (
              <button type="button" className="btn btn--ghost" disabled={!!busy || !selected.length}
                onClick={() => generate('attach')}>
                {busy === 'attach' ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <Paperclip size={14} />}
                Joindre aux documents
              </button>
            )}
            <button type="button" className="btn btn--primary" disabled={!!busy || !selected.length}
              onClick={() => generate('download')}>
              {busy === 'download' ? <span className="login-btn-spinner" /> : <Download size={14} />}
              Télécharger le PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
