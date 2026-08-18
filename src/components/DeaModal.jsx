import { useState, useEffect, useMemo } from 'react'
import {
  X, AlertTriangle, Trash2, FileText, CheckCircle2, MinusCircle, Info,
  HeartPulse, CalendarClock, PackageCheck,
} from 'lucide-react'
import { toast } from 'react-toastify'
import { addDea, updateDea, deleteDea } from '../api/sites'
import { getUsers } from '../api/users'
import { createContract, getNextNumber } from '../api/contracts'
import {
  useCatalogStock, stockOptionsFor, ProductPicker, StockPicker, ConfirmUnknown,
  formatApiError,
} from './stockPickers'

const DEA_CATEGORY = 'defibrillateurs'

function toDateInput(value) {
  if (!value) return ''
  return new Date(value).toISOString().slice(0, 10)
}

function fmtDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const PERIOD_MONTHS = 6

/** Ajoute des mois en restant dans le mois cible (31 août + 6 → 28/29 févr.). */
function addMonths(date, n) {
  const d   = new Date(date)
  const day = d.getDate()
  d.setMonth(d.getMonth() + n)
  if (d.getDate() !== day) d.setDate(0)
  return d
}

/** Personne ne se déplace le week-end : samedi + 2, dimanche + 1. */
function skipWeekend(date) {
  const d  = new Date(date)
  const wd = d.getDay()
  if (wd === 6) d.setDate(d.getDate() + 2)
  else if (wd === 0) d.setDate(d.getDate() + 1)
  return d
}

/** Échéance suivant une visite donnée : six mois plus tard, hors week-end. */
function nextAfter(dateStr) {
  if (!dateStr) return ''
  const base = new Date(dateStr)
  if (Number.isNaN(base.getTime())) return ''
  return toDateInput(skipWeekend(addMonths(base, PERIOD_MONTHS)))
}

/**
 * Calendrier théorique d'un appareil : une visite tous les six mois depuis la
 * pose.
 *
 * Sur un parc repris après coup, la pose est ancienne et le calendrier a déjà
 * couru : les échéances antérieures à aujourd'hui sont réputées honorées. Dire
 * « six mois après la pose » serait alors faux — pour une pose de décembre 2025
 * la prochaine visite tombe un an après, parce qu'une visite a déjà eu lieu
 * entre-temps. Ce sont ces échéances passées qu'il faut montrer : sans elles le
 * calcul paraît arbitraire.
 *
 * Rend le repère (la dernière visite supposée faite), la prochaine échéance, et
 * combien de visites le calendrier a déjà réclamées.
 */
function controlSchedule(dateStr) {
  if (!dateStr) return null
  const base = new Date(dateStr)
  if (Number.isNaN(base.getTime())) return null

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  let last = null
  for (let i = 1; i <= 120; i++) {
    const due = addMonths(base, i * PERIOD_MONTHS)
    if (due > today) {
      return { anchor: base, last, next: skipWeekend(due), passed: i - 1 }
    }
    last = due
  }
  return null
}

/**
 * Création / édition d'un DEA rattaché à un site.
 *
 * Le type vient du catalogue — une valeur inconnue ouvre une confirmation qui
 * propose de la créer. Le numéro de série, lui, se prend au stock quand il y
 * est, et se saisit librement sinon : un parc repris après coup, posé en 2016,
 * n'est jamais passé par le stock, et l'exiger reviendrait à inventer une
 * entrée d'inventaire pour enregistrer un appareil déjà en service.
 * L'exemplaire est alors créé en coulisse, sans rien demander.
 *
 * Le calendrier des visites appartient au contrat du site, mais la date du
 * prochain contrôle reste corrigeable à la main : le calcul part de la pose, ce
 * qui tombe à côté sur un parc ancien.
 *
 * Props :
 *  site     - site propriétaire
 *  dea      - DEA existant (null → création)
 *  contract - contrat en cours du site, s'il y en a un
 *  onClose  - () => void
 *  onSaved  - (site) => void — reçoit le site complet mis à jour
 */
export default function DeaModal({ site, dea, contract, onClose, onSaved }) {
  const isEdit = !!dea?._id
  const underContract = !!contract

  const [form, setForm] = useState({
    location:         dea?.location || '',
    installationDate: toDateInput(dea?.installationDate),
    nextControlDate:  toDateInput(dea?.nextControlDate),
    notes:            dea?.notes || '',
    scheduledDate:    toDateInput(dea?.scheduledDate),
    technician:       dea?.technician?._id || dea?.technician || '',
    technicianName:   dea?.technicianName || '',
  })

  /* Deux façons d'entrer un appareil au parc : consigner une pose déjà faite
     (reprise d'un parc existant), ou réserver l'appareil pour une pose à venir.
     Le second cas garde l'exemplaire au stock, en réservation, jusqu'au compte
     rendu du technicien. */
  const [status, setStatus] = useState(dea?.status || 'installe')
  const planned = status === 'a_installer'

  const [techniciens, setTechniciens] = useState([])
  useEffect(() => {
    if (!planned) return
    getUsers({ role: 'technicien' })
      .then(d => setTechniciens(Array.isArray(d) ? d : (d?.data || [])))
      .catch(() => {})
  }, [planned])

  const { products: devices, stock, addProduct, addStockItem } = useCatalogStock(DEA_CATEGORY)

  // Type retenu : un produit du catalogue, jamais une chaîne libre.
  const [product, setProduct] = useState(null)
  // Exemplaire retenu. En édition, l'appareil est déjà posé donc absent du
  // stock : on reconstitue une entrée « déjà en place » pour l'afficher.
  const [item, setItem] = useState(
    isEdit && dea?.serialNumber
      ? { _id: null, serialNumber: dea.serialNumber, status: 'installe', existing: true }
      : null
  )

  const [serialQuery, setSerialQuery] = useState('')
  // Demande de confirmation en cours : { kind: 'type' | 'stock', label }
  const [confirm,     setConfirm]     = useState(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmErr,  setConfirmErr]  = useState('')

  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Tant que la date de contrôle n'a pas été saisie à la main, elle suit la pose.
  const [controlTouched, setControlTouched] = useState(!!dea?.nextControlManual)
  // Dernière visite déclarée par l'utilisateur, quand le calendrier théorique
  // ne correspond pas à ce qui s'est réellement passé sur le site.
  const [assumedLast, setAssumedLast] = useState('')
  // Mise sous contrat depuis cette modale, quand le site n'en a pas encore.
  const [wantContract, setWantContract] = useState(false)
  const [contractNumber, setContractNumber] = useState('')

  /* Numéro proposé d'office dès qu'on choisit de mettre le site sous contrat. */
  useEffect(() => {
    if (!wantContract || contractNumber) return
    getNextNumber().then(d => setContractNumber(d.number)).catch(() => {})
  }, [wantContract, contractNumber])

  /* Rattache le type du DEA en cours d'édition à sa fiche catalogue, dès que
     celui-ci est chargé. */
  useEffect(() => {
    if (!isEdit || product || devices.length === 0) return
    const found = dea.product
      ? devices.find(d => d._id === String(dea.product._id || dea.product))
      : devices.find(d => d.name.toLowerCase() === (dea.deviceType || '').trim().toLowerCase())
    if (found) setProduct(found)
  }, [devices]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Choisir un type d'abord restreint les numéros proposés à ce modèle. */
  const stockOptions = useMemo(
    () => stockOptionsFor(stock, { product, field: 'serialNumber' }),
    [stock, product]
  )

  function set(field, value) { setForm(f => ({ ...f, [field]: value })) }

  function setInstallationDate(value) {
    // Changer la pose redéroule le calendrier : le repère précédent ne vaut plus.
    setAssumedLast('')
    setForm(f => ({
      ...f,
      installationDate: value,
      nextControlDate: controlTouched
        ? f.nextControlDate
        : (controlSchedule(value)?.next ? toDateInput(controlSchedule(value).next) : ''),
    }))
  }

  /* Repère du calcul : la dernière visite supposée faite. Déduite du calendrier
     par défaut, corrigible quand le terrain sait mieux — c'est ce que les
     utilisateurs ont en tête en ouvrant cet écran (« le dernier passage, c'était
     en mars »), et de là découle tout le reste. */
  const schedule = useMemo(
    () => controlSchedule(form.installationDate),
    [form.installationDate]
  )
  const lastControl = assumedLast || (schedule?.last ? toDateInput(schedule.last) : '')

  /* Ce que le calendrier donne, indépendamment de ce qui est enregistré. Les
     deux peuvent diverger — fiche reprise avec une échéance périmée, date posée
     à la main autrefois : le bloc montre alors le calcul et propose de s'y
     ranger, au lieu d'afficher une suite qui se contredit. */
  const computedNext = assumedLast
    ? nextAfter(assumedLast)
    : (schedule?.next ? toDateInput(schedule.next) : '')
  const differs = !!computedNext && computedNext !== form.nextControlDate

  function setLastControl(value) {
    setAssumedLast(value)
    if (!value) return
    // La date énoncée fait foi : l'échéance qui en découle ne se recalcule plus.
    setControlTouched(true)
    set('nextControlDate', nextAfter(value))
  }

  function applyComputed() {
    setControlTouched(true)
    set('nextControlDate', computedNext)
  }

  /* Prendre un exemplaire au stock renseigne aussi le type : les deux champs
     décrivent le même appareil, les laisser diverger n'aurait pas de sens. */
  function pickItem(it) {
    setItem(it)
    setSerialQuery('')
    const p = devices.find(d => d._id === String(it.product?._id || it.product))
    if (p) setProduct(p)
  }

  function clearProduct() {
    setProduct(null)
    /* L'exemplaire choisi appartenait à l'ancien type : il ne vaut plus. Un
       numéro saisi librement tombe avec lui — il sera entré au stock sous le
       type retenu, et l'enregistrer sous un autre modèle serait faux. Seul le
       numéro d'un DEA déjà enregistré reste : il décrit la machine en place. */
    if (item && (!item.existing || item.adhoc)) setItem(null)
  }

  /* ── Confirmations ── */

  function askCreateType(name) {
    const label = name.trim()
    if (!label) return
    setConfirmErr('')
    setConfirm({ kind: 'type', label })
  }

  function askStockEntry(serial) {
    const label = serial.trim()
    if (!label) return
    setConfirmErr('')
    setConfirm({ kind: 'stock', label })
  }

  /**
   * Numéro de série absent du stock, sur un appareil déjà en service.
   *
   * Rien à confirmer : l'appareil est là, sur le site, depuis des années. On
   * retient le numéro tel quel, et l'exemplaire correspondant sera créé en
   * coulisse à l'enregistrement pour que le stock connaisse lui aussi la machine.
   */
  function acceptSerial(serial) {
    const label = serial.trim()
    if (!label) return
    setItem({ _id: null, serialNumber: label, status: 'installe', existing: true, adhoc: true })
    setSerialQuery('')
  }

  async function runConfirm() {
    setConfirmBusy(true)
    setConfirmErr('')
    try {
      if (confirm.kind === 'type') {
        const p = await addProduct(confirm.label, DEA_CATEGORY)
        setProduct(p)
        toast.success(`Type « ${p.name} » créé.`)
      } else {
        setItem(await addStockItem(product, { serialNumber: confirm.label }))
        setSerialQuery('')
        toast.success(`N° ${confirm.label} entré en stock.`)
      }
      setConfirm(null)
    } catch (err) {
      setConfirmErr(formatApiError(err))
    } finally {
      setConfirmBusy(false)
    }
  }

  /* ── Enregistrement ── */

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!product) {
      setError('Choisissez un type dans le catalogue — ou créez-le depuis le champ Type.')
      return
    }

    /* Une saisie laissée en plan dans le champ série serait perdue en silence.
       Une pose à venir doit sortir d'un exemplaire réel, donc réservé au stock ;
       un appareil déjà en service se contente du numéro tel qu'il est écrit. */
    let picked = item
    if (!picked && serialQuery.trim()) {
      if (planned) { askStockEntry(serialQuery); return }
      picked = { serialNumber: serialQuery.trim(), adhoc: true }
    }

    if (planned && !form.scheduledDate) {
      setError('Indiquez la date prévue pour la pose.')
      return
    }

    setLoading(true)
    try {
      /* Régularisation discrète du stock : l'appareil posé hors inventaire y
         entre pour que sa fiche article existe. Son échec ne doit pas coûter
         l'enregistrement du parc, qui est ce que l'utilisateur a demandé. */
      if (picked?.adhoc) {
        await addStockItem(product, { serialNumber: picked.serialNumber }).catch(() => {})
      }

      const payload = {
        ...form,
        status,
        product:          product._id,
        deviceType:       product.name,
        serialNumber:     picked?.serialNumber || '',
        // Une pose seulement prévue n'a pas encore de date d'installation :
        // c'est le compte rendu du technicien qui la fixera.
        installationDate: planned ? null : (form.installationDate || null),
        scheduledDate:    planned ? form.scheduledDate : null,
        technician:       planned ? (form.technician || null) : null,
        technicianName:   planned ? form.technicianName : '',
        nextControlDate:  form.nextControlDate  || null,
        // Corrigée à la main : le calendrier du contrat ne la réécrira plus.
        nextControlManual: controlTouched && !!form.nextControlDate,
      }
      let updated = isEdit
        ? await updateDea(site._id, dea._id, payload)
        : await addDea(site._id, payload)
      toast.success(isEdit ? 'DEA mis à jour.'
        : planned
          ? 'Pose planifiée — l\'appareil est réservé pour ce client.'
          : 'DEA ajouté au parc du site.')

      /* Le contrat vient après l'appareil : il en faut au moins un pour qu'il y
         ait quelque chose à contrôler. Son échec ne perd pas le DEA enregistré. */
      if (wantContract && !underContract) {
        try {
          await createContract({ site: site._id, contractNumber: contractNumber.trim() })
          toast.success('Contrat créé — visites planifiées depuis la date de pose.')
        } catch (err) {
          toast.error(`DEA enregistré, mais le contrat n'a pas pu être créé : ${formatApiError(err)}`)
        }
      }

      onSaved(updated)
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete() {
    setError('')
    setDeleting(true)
    try {
      const updated = await deleteDea(site._id, dea._id)
      toast.success('DEA retiré du site.')
      onSaved(updated)
    } catch (err) {
      setError(formatApiError(err))
      setDeleting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Modifier le DEA' : 'Nouveau DEA'}</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <p className="dea-modal-site">Site : <strong>{site.name}</strong></p>

          {/* Ce qu'on enregistre : un appareil déjà en service, ou une pose à
              venir. Le stock suit — installé d'un côté, réservé de l'autre. */}
          {!isEdit && (
            <div className="form-group">
              <label className="form-label">Situation de l'appareil *</label>
              <div className="dea-status-row">
                <button type="button"
                  className={`dea-status${!planned ? ' dea-status--on' : ''}`}
                  onClick={() => setStatus('installe')}>
                  <HeartPulse size={15} />
                  <span>
                    <strong>Déjà en service</strong>
                    <em>Pose antérieure — l'appareil est en place sur le site.</em>
                  </span>
                </button>
                <button type="button"
                  className={`dea-status${planned ? ' dea-status--on' : ''}`}
                  onClick={() => setStatus('a_installer')}>
                  <CalendarClock size={15} />
                  <span>
                    <strong>Pose à planifier</strong>
                    <em>Réservé pour ce client, posé lors d'une prochaine visite.</em>
                  </span>
                </button>
              </div>
            </div>
          )}

          {isEdit && dea?.status === 'a_installer' && (
            <div className="dea-contract-on">
              <CalendarClock size={14} />
              <span>
                Pose planifiée{dea.scheduledDate ? ` pour le ${fmtDate(dea.scheduledDate)}` : ''}.
                La mise en service se valide par le compte rendu de pose du technicien.
              </span>
            </div>
          )}

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Type *</label>
              <ProductPicker
                products={devices}
                value={product}
                onChange={setProduct}
                onClear={clearProduct}
                onUnknown={askCreateType}
                noun="modèle de DEA"
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                N° de série{' '}
                <span className="form-label-opt">
                  {planned ? '(depuis le stock)' : '(facultatif)'}
                </span>
              </label>
              <StockPicker
                items={stockOptions}
                value={item}
                onChange={pickItem}
                onClear={() => setItem(null)}
                onUnknown={planned ? askStockEntry : acceptSerial}
                onQueryChange={setSerialQuery}
                field="serialNumber"
                product={product}
                createLabel={planned ? undefined : q => `Utiliser le n° « ${q} »`}
              />
              {!item && (
                <p className="form-hint">
                  {planned
                    ? 'Seuls les appareils encore en stock sont proposés — la pose les réserve.'
                    : 'Le stock propose ce qu\'il connaît. Un appareil posé avant son suivi n\'y est pas : tapez son numéro, il sera enregistré tel quel.'}
                </p>
              )}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Emplacement dans le site</label>
            <input className="form-input form-input--plain" value={form.location}
              onChange={e => set('location', e.target.value)} placeholder="Ex : Hall d'accueil, 2e étage" />
          </div>

          {planned ? (
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Date prévue de pose *</label>
                <input type="date" className="form-input form-input--plain" value={form.scheduledDate}
                  onChange={e => set('scheduledDate', e.target.value)} />
                <p className="form-hint">
                  <PackageCheck size={11} /> L'exemplaire reste au stock, en réservation,
                  jusqu'au compte rendu de pose.
                </p>
              </div>
              <div className="form-group">
                <label className="form-label">Technicien</label>
                <select className="form-input form-input--plain" value={form.technician}
                  onChange={e => {
                    const t = techniciens.find(u => u._id === e.target.value)
                    setForm(f => ({
                      ...f,
                      technician:     t?._id || '',
                      technicianName: t?.fullName || t?.username || '',
                    }))
                  }}>
                  <option value="">— Non assigné —</option>
                  {techniciens.map(t => (
                    <option key={t._id} value={t._id}>{t.fullName || t.username}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
          <>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Date d'installation</label>
              <input type="date" className="form-input form-input--plain" value={form.installationDate}
                onChange={e => setInstallationDate(e.target.value)} />
            </div>
            {/* Le contrat propose l'échéance, il ne l'impose pas : sur un parc
                repris des années après la pose, le calcul tombe à côté et c'est
                le terrain qui sait quand la visite est réellement due. */}
            <div className="form-group">
              <label className="form-label">Prochain contrôle</label>
              <input type="date" className="form-input form-input--plain" value={form.nextControlDate}
                onChange={e => { setControlTouched(true); set('nextControlDate', e.target.value) }} />
              {controlTouched && (
                <p className="form-hint">
                  <Info size={11} /> Date fixée à la main
                  {underContract && ' — elle remplace celle calculée par le contrat'}.
                </p>
              )}
            </div>
          </div>

          {/* D'où sort la date proposée. « Six mois après la pose » est faux dès
              que le calendrier a déjà couru : pour une pose de 2025, la prochaine
              visite tombe un an après, parce qu'une autre a eu lieu entre-temps.
              Cette visite intermédiaire, personne ne la voit — d'où l'impression
              d'une date sortie de nulle part. On la nomme, et on la corrige. */}
          {schedule && (
            <div className="ctrl-basis">
              <span className="ctrl-basis-icon"><CalendarClock size={15} /></span>
              <div className="ctrl-basis-body">
                <p className="ctrl-basis-line">
                  Une visite tous les six mois depuis la pose du{' '}
                  <strong>{fmtDate(schedule.anchor)}</strong>.
                  {schedule.passed > 0 ? (
                    <>
                      {' '}{schedule.passed === 1
                        ? 'Une visite était déjà due'
                        : `${schedule.passed} visites étaient déjà dues`}
                      {' '}avant aujourd'hui — on {schedule.passed === 1 ? 'la' : 'les'} suppose
                      {' '}faite{schedule.passed === 1 ? '' : 's'}.
                    </>
                  ) : (
                    <> Aucune visite n'est encore due : celle-ci sera la première.</>
                  )}
                </p>

                {/* Pas de « + 6 mois = » affiché : le pas de six mois se compte
                    depuis la pose, et un mois plus court décale la somme
                    (28/02 → 31/08). Une égalité fausse à l'écran est exactement
                    ce qui a fait douter du calcul. */}
                {schedule.passed > 0 && (
                  <div className="ctrl-basis-calc">
                    <label className="ctrl-basis-field">
                      <span>Dernier contrôle{assumedLast ? '' : ' (supposé)'}</span>
                      <input type="date" className="form-input form-input--plain"
                        value={lastControl}
                        onChange={e => setLastControl(e.target.value)} />
                    </label>
                    <span className="ctrl-basis-arrow">→</span>
                    <span className="ctrl-basis-field">
                      <span>Prochain contrôle</span>
                      <span className="ctrl-basis-result">
                        {computedNext ? fmtDate(computedNext) : '—'}
                      </span>
                    </span>
                    {differs && (
                      <button type="button" className="btn btn--ghost btn--sm ctrl-basis-apply"
                        onClick={applyComputed}>
                        Utiliser cette date
                      </button>
                    )}
                  </div>
                )}

                <p className="ctrl-basis-note">
                  {differs
                    ? `La fiche porte actuellement ${form.nextControlDate ? fmtDate(form.nextControlDate) : 'aucune date'}, qui ne suit pas ce calendrier.`
                    : schedule.passed > 0
                      ? "Si le dernier passage a eu lieu à une autre date, corrigez-la : l'échéance suit."
                      : 'Modifiable directement dans le champ ci-dessus.'}
                  {underContract && ' Une date posée ici remplace celle du contrat.'}
                </p>
              </div>
            </div>
          )}
          </>
          )}

          {/* ── Contrat de maintenance du site ── */}
          <div className="form-group">
            <label className="form-label">Site sous contrat de maintenance</label>

            {underContract ? (
              <div className="dea-contract-on">
                <FileText size={14} />
                <span>
                  Oui — contrat <strong>{contract.contractNumber || 'sans numéro'}</strong>.
                  Pour y mettre fin, passez par la fiche du contrat.
                </span>
              </div>
            ) : (
              <>
                <div className="choice-row">
                  <button type="button"
                    className={`choice-btn${wantContract ? ' choice-btn--on choice-btn--on-green' : ''}`}
                    onClick={() => setWantContract(true)}>
                    <CheckCircle2 size={15} /> Oui
                  </button>
                  <button type="button"
                    className={`choice-btn${!wantContract ? ' choice-btn--on' : ''}`}
                    onClick={() => setWantContract(false)}>
                    <MinusCircle size={15} /> Non
                  </button>
                </div>

                {wantContract && (
                  <div className="dea-contract-new">
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Numéro de contrat</label>
                      <input className="form-input form-input--plain" value={contractNumber}
                        onChange={e => setContractNumber(e.target.value)} placeholder="CT-2026-0001" />
                    </div>
                    <p className="form-hint">
                      <Info size={12} /> Contrat d'un an à compter d'aujourd'hui. Les visites seront
                      planifiées tous les six mois <strong>à partir de la date de pose</strong> :
                      la première est semestrielle, la suivante — à l'anniversaire — est annuelle.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-input form-input--plain form-textarea" value={form.notes}
              onChange={e => set('notes', e.target.value)} rows={2}
              placeholder="Informations complémentaires…" />
          </div>

          {isEdit && (
            <p className="cd-empty-hint" style={{ padding: 0 }}>
              Les électrodes et batteries se gèrent depuis le tableau des sites.
            </p>
          )}

          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}

          <div className="modal-footer">
            {isEdit && (
              <button type="button" className="btn btn--danger" style={{ marginRight: 'auto' }}
                onClick={handleDelete} disabled={deleting || loading}>
                {deleting ? <span className="login-btn-spinner" /> : <><Trash2 size={14} /> Retirer</>}
              </button>
            )}
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary" disabled={loading || deleting}>
              {loading ? <span className="login-btn-spinner" /> : isEdit ? 'Enregistrer' : 'Ajouter le DEA'}
            </button>
          </div>
        </form>
      </div>

      {confirm && (
        <ConfirmUnknown
          mode={confirm.kind === 'type' ? 'product' : 'stock'}
          label={confirm.label}
          product={product}
          field="serialNumber"
          categoryLabel="nouveau modèle de défibrillateur"
          busy={confirmBusy}
          error={confirmErr}
          onConfirm={runConfirm}
          onCancel={() => { setConfirm(null); setConfirmErr('') }}
        />
      )}
    </div>
  )
}
