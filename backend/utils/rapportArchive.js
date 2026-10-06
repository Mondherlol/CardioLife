const path   = require('path')
const fsp    = require('fs/promises')
const crypto = require('crypto')

const Document = require('../models/Document')
const Client   = require('../models/Client')
const { getOrCreateClientFolder } = require('./clientDocsFolder')

const UPLOAD_DIR = path.join(__dirname, '../uploads/documents')
const RAPPORTS_FOLDER_NAME = "Rapports d'intervention"
const RAPPORTS_KIND = 'rapports'

const TYPE_LABELS = {
  semestriel:   'Contrôle semestriel',
  annuel:       'Contrôle annuel',
  hors_contrat: 'Contrôle hors contrat',
  intervention: 'Intervention',
}

async function systemFolder(name, parent, userId) {
  let folder = await Document.findOne({ name, parent, type: 'folder', isDeleted: false })
  if (!folder) {
    folder = await Document.create({
      name, type: 'folder', parent, isSystem: true, systemKind: RAPPORTS_KIND, createdBy: userId,
    })
  } else if (folder.systemKind !== RAPPORTS_KIND) {
    // Dossier créé à la main sous ce nom avant la fonctionnalité : on l'adopte.
    folder.isSystem = true
    folder.systemKind = RAPPORTS_KIND
    await folder.save()
  }
  return folder
}

/** Nom du fichier : la date en tête, pour que l'ordre alphabétique soit chronologique. */
function rapportName(intervention) {
  const when = new Date(intervention.completedDate || intervention.scheduledDate || Date.now())
  const day  = [
    when.getFullYear(),
    String(when.getMonth() + 1).padStart(2, '0'),
    String(when.getDate()).padStart(2, '0'),
  ].join('-')
  const type = TYPE_LABELS[intervention.controlType] || 'Intervention'
  const site = intervention.site?.name || intervention.siteName || ''
  return [day, type, site].filter(Boolean).join(' — ')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Évite deux fichiers homonymes dans le dossier de l'année (deux visites le même jour). */
async function freeName(base, parent, exceptId) {
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${base}.pdf` : `${base} (${n}).pdf`
    const taken = await Document.exists({
      name, parent, isDeleted: false, _id: { $ne: exceptId },
    })
    if (!taken) return name
  }
}

/**
 * Range le rapport PDF d'une intervention dans
 * « Clients/<Client>/Rapports d'intervention/<Année>/ ».
 *
 * Une intervention n'a qu'un rapport : une nouvelle clôture après correction
 * remplace le fichier existant au lieu d'en empiler un second.
 */
async function archiveRapport(intervention, buffer, userId) {
  const client = await Client.findById(intervention.client?._id || intervention.client)
  if (!client) throw new Error("Cette intervention n'est rattachée à aucun client.")

  const clientFolder   = await getOrCreateClientFolder(client, userId)
  const rapportsFolder = await systemFolder(RAPPORTS_FOLDER_NAME, clientFolder._id, userId)
  const year = String(new Date(intervention.completedDate || intervention.scheduledDate || Date.now()).getFullYear())
  const yearFolder     = await systemFolder(year, rapportsFolder._id, userId)

  const siteId = intervention.site?._id || intervention.site || undefined
  const storageKey = `${crypto.randomUUID()}.pdf`
  await fsp.mkdir(UPLOAD_DIR, { recursive: true })
  await fsp.writeFile(path.join(UPLOAD_DIR, storageKey), buffer)

  let doc = intervention.rapportDocument
    ? await Document.findOne({ _id: intervention.rapportDocument, isDeleted: false })
    : null
  const name = await freeName(rapportName(intervention), yearFolder._id, doc?._id)

  if (doc) {
    const oldKey = doc.storageKey
    Object.assign(doc, {
      name, parent: yearFolder._id, size: buffer.length, storageKey,
      mimeType: 'application/pdf', intervention: intervention._id, site: siteId,
    })
    await doc.save()
    if (oldKey && oldKey !== storageKey) {
      await fsp.unlink(path.join(UPLOAD_DIR, oldKey)).catch(() => {})
    }
  } else {
    doc = await Document.create({
      name, type: 'file', parent: yearFolder._id,
      mimeType: 'application/pdf', size: buffer.length, storageKey,
      intervention: intervention._id, site: siteId, createdBy: userId,
    })
  }
  return doc
}

module.exports = { archiveRapport, RAPPORTS_FOLDER_NAME, RAPPORTS_KIND }
