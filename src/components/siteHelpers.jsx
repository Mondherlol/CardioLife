import {
  Zap, BatteryMedium, Check, Minus, HeartPulse, Plus, PackageCheck, CalendarClock,
} from 'lucide-react'

/* Helpers partagés par les deux vues des sites client (tableau et fiches). */

export function formatApiError(err) {
  if (err.errors?.length) return err.errors.map(e => e.msg).join(' · ')
  return err.message || 'Une erreur est survenue.'
}

export function formatDate(value) {
  if (!value) return null
  return new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/* Date ISO → 'yyyy-mm-dd' pour <input type="date">. */
export function toDateInput(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

export function daysUntil(value) {
  if (!value) return null
  const target = new Date(value)
  const now = new Date()
  const t = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  const n = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((t - n) / 86400000)
}

/**
 * Ce qu'une date de péremption veut dire, en clair.
 *
 * « 01/12/2027 » ne se convertit pas de tête en délai : à la saisie comme à la
 * lecture, c'est le nombre de jours restants qui dit s'il faut commander la
 * pièce. La couleur suit les seuils du reste du parc.
 */
export function expiryHint(value) {
  const days = daysUntil(value)
  if (days == null) return null
  if (days < 0) {
    const n = Math.abs(days)
    return { level: 'expired', text: `Périmé depuis ${n} jour${n > 1 ? 's' : ''}` }
  }
  if (days === 0) return { level: 'expired', text: "Périme aujourd'hui" }
  return {
    level: days <= 60 ? 'soon' : 'ok',
    text:  `Périme dans ${days} jour${days > 1 ? 's' : ''}`,
  }
}

/* État global d'une liste de consommables : le plus urgent l'emporte. */
export function itemsStatus(items) {
  if (!items?.length) return { level: 'none', count: 0, soonest: null }
  const dates = items.map(i => i.expiryDate).filter(Boolean)
  if (!dates.length) return { level: 'unknown', count: items.length, soonest: null }
  const soonest = dates.reduce((a, b) => (new Date(a) < new Date(b) ? a : b))
  const days = daysUntil(soonest)
  const level = days < 0 ? 'expired' : days <= 60 ? 'soon' : 'ok'
  return { level, count: items.length, soonest, days }
}

/**
 * Échéance du prochain contrôle, colorée par son urgence et cliquable pour la
 * corriger. Le calcul automatique part de la pose : sur un parc ancien il tombe
 * souvent à côté, la date doit donc rester rattrapable ici, sans quitter la
 * fiche du client.
 */
export function NextControlChip({ dea, onClick }) {
  const date  = dea?.nextControlDate
  const days  = daysUntil(date)
  const level = !date ? 'none' : days < 0 ? 'expired' : days <= 30 ? 'soon' : 'ok'

  const title = !date
    ? 'Aucune échéance — cliquez pour en fixer une'
    : `${days < 0 ? `En retard de ${Math.abs(days)} j` : days === 0 ? "Aujourd'hui" : `Dans ${days} j`}`
      + `${dea.nextControlManual ? ' · date fixée à la main' : ''} — cliquez pour modifier`

  return (
    <button type="button" className={`ctrl-chip ctrl-chip--${level}`} title={title}
      onClick={e => { e.stopPropagation(); onClick() }}>
      <CalendarClock size={11} />
      {date
        ? <span className="ctrl-chip-date">{formatDate(date)}</span>
        : <span className="ctrl-chip-date ctrl-chip-date--none">À fixer</span>}
      {dea?.nextControlManual && <span className="ctrl-chip-manual" title="Fixée à la main">·</span>}
    </button>
  )
}

/** Contenu commun aux deux pastilles de consommables. */
function itemsChipParts(kind, items, full) {
  const st    = itemsStatus(items)
  const Icon  = kind === 'batteries' ? BatteryMedium : Zap
  const label = kind === 'batteries' ? 'Batteries' : 'Électrodes'
  const short = kind === 'batteries' ? 'Batt.' : 'Élec.'
  return {
    st,
    className: `dea-chip dea-chip--${st.level}${full ? ' dea-chip--full' : ''}`,
    title: st.soonest
      ? `${label} · ${st.count} · péremption ${formatDate(st.soonest)}`
      : `${label} · ${st.count || 'aucune'}`,
    body: (
      <>
        <Icon size={full ? 13 : 11} strokeWidth={2} />
        <span className="dea-chip-label">{full ? label : short}</span>
        {st.count > 0 && <span className="dea-chip-count">{st.count}</span>}
        {full && st.soonest && <span className="dea-chip-date">{formatDate(st.soonest)}</span>}
      </>
    ),
  }
}

/**
 * Pastille de consommables : icône, compte et couleur d'urgence.
 * `full` affiche le libellé complet et la date (vue fiches).
 */
export function ItemsButton({ kind, items, onClick, full }) {
  const { className, title, body } = itemsChipParts(kind, items, full)
  return (
    <button
      type="button"
      className={className}
      title={title}
      onClick={e => { e.stopPropagation(); onClick() }}
    >
      {body}
    </button>
  )
}

/**
 * État détaillé des consommables d'un DAE, pour la liste des clients.
 *
 * La pastille ne disait qu'un nombre : il fallait ouvrir le site pour savoir si
 * une batterie était à plat ou des électrodes périmées. Or c'est justement
 * depuis cette liste qu'on décide d'appeler un client — le niveau de charge et
 * l'échéance doivent donc s'y lire directement.
 *
 * La cellule reste cliquable : elle ouvre la gestion de la pièce, comme la
 * pastille qu'elle remplace.
 */
export function ItemsCell({ kind, items, onClick }) {
  const isBatt = kind === 'batteries'
  const Icon   = isBatt ? BatteryMedium : Zap

  if (!items?.length) {
    return (
      <button type="button" className="items-cell items-cell--empty"
        title={`Aucune ${isBatt ? 'batterie' : 'électrode'} enregistrée — cliquez pour en ajouter`}
        onClick={e => { e.stopPropagation(); onClick() }}>
        <Icon size={12} />
        <span>Non renseigné</span>
      </button>
    )
  }

  return (
    <button type="button" className="items-cell"
      title={`Modifier ${isBatt ? 'les batteries' : 'les électrodes'}`}
      onClick={e => { e.stopPropagation(); onClick() }}>
      {items.map((it, i) => {
        const days  = daysUntil(it.expiryDate)
        const level = days == null ? 'unknown' : days < 0 ? 'expired' : days <= 60 ? 'soon' : 'ok'
        // Le niveau de charge a sa propre urgence : une batterie pleine dont la
        // péremption est lointaine reste à remplacer si elle se vide.
        const pct      = isBatt ? it.level : null
        const pctLevel = pct == null ? null : pct < 25 ? 'expired' : pct < 50 ? 'soon' : 'ok'

        return (
          <span key={it._id || i} className="items-cell-line">
            <Icon size={11} className="items-cell-icon" />
            {/* Des électrodes, on veut la péremption : leur genre se lit sur la
                fiche du DAE, il n'aide pas à décider d'un appel client. */}
            {isBatt && (
              <span className="items-cell-main">
                {pct != null
                  ? <span className={`items-cell-pct items-cell-pct--${pctLevel}`}>{pct} %</span>
                  : <span className="items-cell-none">niveau —</span>}
              </span>
            )}
            <span className={`items-cell-date items-cell-date--${level}`}>
              {it.expiryDate ? formatDate(it.expiryDate) : 'DLC —'}
            </span>
          </span>
        )
      })}
    </button>
  )
}

/**
 * Le site est-il sous contrat ? Oui ou non, rien de plus : le détail (numéro,
 * période, calendrier des visites) vit sur la fiche du site.
 */
export function ContractChip({ contract }) {
  return contract
    ? (
      <span className="ct-chip ct-chip--on" title={contract.contractNumber || 'Sous contrat'}>
        <Check size={12} /> Oui
      </span>
    ) : (
      <span className="ct-chip ct-chip--none" title="Aucun contrat de maintenance sur ce site">
        <Minus size={12} /> Non
      </span>
    )
}

/**
 * Ce qu'on montre à la place du parc quand un site n'a encore aucun DEA.
 *
 * Le matériel déjà réservé pour le client dort autrement dans le stock : il
 * s'affiche ici, à l'endroit exact où l'appareil manque, avec le geste qui le
 * met en service. Sans réservation, seul l'ajout manuel reste proposé.
 */
export function NoDeaBox({ site, act, wide }) {
  const waiting = act.reservedFor?.(site) || []

  if (waiting.length > 0) {
    return (
      <div className={`nodea-box nodea-box--resa${wide ? ' nodea-box--wide' : ''}`}
        onClick={e => e.stopPropagation()}>
        <span className="nodea-resa-icon"><PackageCheck size={16} /></span>
        <div className="nodea-resa-main">
          <span className="nodea-resa-title">
            {waiting.length} article{waiting.length > 1 ? 's' : ''} en attente d'installation
          </span>
          <div className="nodea-resa-list">
            {waiting.slice(0, 3).map(it => (
              <span key={it._id} className="resa-chip">
                {it.product?.name || 'Article'}
                {it.serialNumber && <> · {it.serialNumber}</>}
              </span>
            ))}
            {waiting.length > 3 && (
              <span className="resa-chip resa-chip--more">+{waiting.length - 3}</span>
            )}
          </div>
        </div>
        <div className="nodea-resa-actions">
          <button type="button" className="btn btn--primary btn--sm"
            onClick={() => act.planInstall(site)}>
            <CalendarClock size={13} /> Planifier l'installation
          </button>
          <button type="button" className="nodea-btn nodea-btn--quiet"
            onClick={() => act.addDea(site)}>
            <Plus size={12} /> Ajouter un DEA
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`nodea-box${wide ? ' nodea-box--wide' : ''}`}>
      <HeartPulse size={wide ? 18 : 16} />
      <span className="nodea-text">Aucun DEA sur ce site</span>
      {/* Le clic ne doit pas remonter à la ligne, qui ouvre la fiche du site. */}
      <button type="button" className="nodea-btn"
        onClick={e => { e.stopPropagation(); act.addDea(site) }}>
        <Plus size={12} /> Ajouter un DEA
      </button>
    </div>
  )
}
