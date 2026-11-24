import {
  GraduationCap, CalendarDays, FileText, Users, User, Send, Mail,
  Building2, AlertTriangle, Check, PauseCircle, Bell,
} from 'lucide-react'
import {
  stageOf, countParticipants, attestationRecipient, fmtFormationDate, pendingFormations,
  isOnHold, relanceDue,
} from '../lib/formations'

/* Chips d'étape : le même jeu de couleurs que la fiche site (`sd-chip`). */
const TONE_CLS = {
  blue:  'sd-chip--blue',
  amber: 'sd-chip--amber',
  green: 'sd-chip--green',
  muted: 'sd-chip--muted',
}

export function StageChip({ formation }) {
  // Reportée sans date : c'est ce qu'il faut lire en premier, pas « Programmé ».
  if (isOnHold(formation)) {
    return <span className={`sd-chip ${relanceDue(formation) ? 'sd-chip--red' : TONE_CLS.amber}`}>
      <PauseCircle size={11} /> Date à définir
    </span>
  }
  const st = stageOf(formation)
  return <span className={`sd-chip ${TONE_CLS[st.tone]}`}>{st.label}</span>
}

/**
 * Une formation, telle qu'elle apparaît partout : fiche client, fiche site et
 * onglet Maintenance. Un seul rendu, donc une seule lecture à apprendre.
 */
export function FormationRow({ formation: f, onClick, showClient = false, showSite = true }) {
  const counts    = countParticipants(f)
  const recipient = attestationRecipient(f)
  const stage     = stageOf(f)
  const site      = f.site?.name || f.siteName

  return (
    <div className="sd-row sd-row--link fm-row" onClick={() => onClick?.(f)}
      role="button" tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick?.(f)}>
      <span className="sd-row-icon"><GraduationCap size={15} /></span>

      <div className="sd-row-main">
        <div className="sd-row-title">{f.title}</div>
        <div className="sd-row-meta">
          <span><CalendarDays size={11} /> {isOnHold(f)
            ? <>Date à définir <em style={{ opacity: 0.7 }}>(prévue le {fmtFormationDate(f.date)})</em></>
            : fmtFormationDate(f.date)}</span>
          {showClient && f.clientName && <span><Building2 size={11} /> {f.clientName}</span>}
          {showSite && site && <span><Building2 size={11} /> {site}</span>}
          {f.assignedTo?.length > 0 && (
            <span><User size={11} /> {f.assignedTo.map(u => u.fullName || u.username).join(', ')}</span>
          )}
          <span><FileText size={11} /> {f.documents?.length || 0} doc{(f.documents?.length || 0) !== 1 ? 's' : ''}</span>
        </div>

        {/* Ce qui reste à faire se lit sans ouvrir la fiche. */}
        {stage.id === 'termine' && (
          <div className="fm-row-todo">
            {recipient?.email
              ? <><Send size={11} /> Attestations à envoyer à {recipient.name || recipient.email}</>
              : <><AlertTriangle size={11} /> Attestations à envoyer — aucun destinataire renseigné</>}
          </div>
        )}
        {isOnHold(f) && (
          <div className={`fm-row-todo${relanceDue(f) ? '' : ' fm-row-todo--soft'}`}>
            <PauseCircle size={11} /> Reportée{f.attenteMotif ? ` — ${f.attenteMotif}` : ''}
            {f.relanceDate && <> · <Bell size={11} /> {relanceDue(f) ? 'à relancer depuis le' : 'relance le'} {new Date(f.relanceDate).toLocaleDateString('fr-FR')}</>}
          </div>
        )}
        {stage.id === 'programme' && !isOnHold(f) && counts.a_former > 0 && (
          <div className="fm-row-todo fm-row-todo--soft">
            <Users size={11} /> {counts.a_former} agent{counts.a_former > 1 ? 's' : ''} à former
          </div>
        )}
      </div>

      {counts.total > 0 ? (
        <span className="sd-chip sd-chip--slate" title={`${counts.forme} formés · ${counts.a_former} à former`}>
          <Users size={11} /> {counts.forme}/{counts.total}
        </span>
      ) : f.participantsCount > 0 && (
        <span className="sd-chip sd-chip--slate"><Users size={11} /> {f.participantsCount} pers.</span>
      )}

      <StageChip formation={f} />
    </div>
  )
}

/**
 * Aperçu « ce qui est en cours » — bandeau posé en tête des fiches client et
 * site : ce qui est programmé, et ce dont les attestations attendent encore.
 */
export function FormationsSummary({ formations = [], onPick }) {
  const pending   = pendingFormations(formations)
  const scheduled = pending.filter(f => stageOf(f).id === 'programme' && !isOnHold(f))
  const onHold    = pending.filter(isOnHold)
  const toDeliver = pending.filter(f => stageOf(f).id === 'termine')

  if (formations.length === 0) return null

  if (pending.length === 0) {
    return (
      <div className="fm-summary fm-summary--ok">
        <Check size={14} />
        <span>Tout est à jour — aucune formation en attente.</span>
      </div>
    )
  }

  const next = scheduled[0]

  return (
    <div className="fm-summary">
      <div className="fm-summary-stats">
        <button type="button" className="fm-summary-stat" onClick={() => next && onPick?.(next)}>
          <span className="fm-summary-num">{scheduled.length}</span>
          <span className="fm-summary-label"><CalendarDays size={11} /> programmée{scheduled.length > 1 ? 's' : ''}</span>
        </button>
        <button type="button" className="fm-summary-stat fm-summary-stat--warn"
          onClick={() => toDeliver[0] && onPick?.(toDeliver[0])}>
          <span className="fm-summary-num">{toDeliver.length}</span>
          <span className="fm-summary-label"><Send size={11} /> attestation{toDeliver.length > 1 ? 's' : ''} à livrer</span>
        </button>
        {onHold.length > 0 && (
          <button type="button" className="fm-summary-stat fm-summary-stat--warn" onClick={() => onPick?.(onHold[0])}>
            <span className="fm-summary-num">{onHold.length}</span>
            <span className="fm-summary-label"><PauseCircle size={11} /> en attente de date</span>
          </button>
        )}
      </div>

      <div className="fm-summary-next">
        {next ? (
          <>
            <span className="fm-summary-next-label">Prochaine séance</span>
            <button type="button" className="fm-summary-next-link" onClick={() => onPick?.(next)}>
              {next.title} — {fmtFormationDate(next.date, true)}
            </button>
          </>
        ) : toDeliver[0] && (
          <>
            <span className="fm-summary-next-label">À envoyer</span>
            <button type="button" className="fm-summary-next-link" onClick={() => onPick?.(toDeliver[0])}>
              {attestationRecipient(toDeliver[0])?.email
                ? <><Mail size={11} /> {attestationRecipient(toDeliver[0]).email}</>
                : toDeliver[0].title}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
