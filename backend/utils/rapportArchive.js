const path   = require('path')
const fsp    = require('fs/promises')
const crypto = require('crypto')

const Document = require('../models/Document')
const Client   = require('../models/Client')
const { getOrCreateClientFolder } = require('./clientDocsFolder')

const UPLOAD_DIR = path.join(__dirname, '../uploads/documents')
const RAPPORTS_FOLDER_NAME = "Rapports d'intervention"
const BONS_FOLDER_NAME     = "Bons d'intervention"
// Dossiers de documents datés : lus du plus récent au plus ancien.
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

function dayOf(date) {
  const when = new Date(date || Date.now())
  return [
    when.getFullYear(),
    String(when.getMonth() + 1).padStart(2, '0'),
    String(when.getDate()).padStart(2, '0'),
  ].join('-')
}

/** Nom de fichier : la date en tête, pour que l'ordre alphabétique soit chronologique. */
function cleanName(parts) {
  return parts.filter(Boolean).join(' — ')
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
 * Range un PDF dans « Clients/<Client>/<dossier>/<Année>/ ».
 *
 * Un document par visite : `existingId` désigne le fichier déjà rangé, qui est
 * remplacé (nouvelle clôture, bon réimprimé) au lieu d'en empiler un second.
 */
async function archivePdf({ clientId, folderName, date, baseName, buffer, existingId, links, userId }) {
  const client = await Client.findById(clientId)
  if (!client) throw new Error("Ce document n'est rattaché à aucun client.")

  const clientFolder = await getOrCreateClientFolder(client, userId)
  const kindFolder   = await systemFolder(folderName, clientFolder._id, userId)
  const yearFolder   = await systemFolder(String(new Date(date || Date.now()).getFullYear()), kindFolder._id, userId)

  const storageKey = `${crypto.randomUUID()}.pdf`
  await fsp.mkdir(UPLOAD_DIR, { recursive: true })
  await fsp.writeFile(path.join(UPLOAD_DIR, storageKey), buffer)

  let doc = existingId ? await Document.findOne({ _id: existingId, isDeleted: false }) : null
  const name = await freeName(baseName, yearFolder._id, doc?._id)

  if (doc) {
    const oldKey = doc.storageKey
    Object.assign(doc, {
      name, parent: yearFolder._id, size: buffer.length, storageKey, mimeType: 'application/pdf', ...links,
    })
    await doc.save()
    if (oldKey && oldKey !== storageKey) {
      await fsp.unlink(path.join(UPLOAD_DIR, oldKey)).catch(() => {})
    }
  } else {
    doc = await Document.create({
      name, type: 'file', parent: yearFolder._id,
      mimeType: 'application/pdf', size: buffer.length, storageKey,
      createdBy: userId, ...links,
    })
  }
  return doc
}

/**
 * Rapport PDF d'une intervention, dans « Rapports d'intervention ».
 * Une nouvelle clôture après correction remplace le fichier existant.
 */
async function archiveRapport(intervention, buffer, userId) {
  const date = intervention.completedDate || intervention.scheduledDate
  return archivePdf({
    clientId:   intervention.client?._id || intervention.client,
    folderName: RAPPORTS_FOLDER_NAME,
    date,
    baseName:   cleanName([
      dayOf(date),
      TYPE_LABELS[intervention.controlType] || 'Intervention',
      intervention.site?.name || intervention.siteName,
    ]),
    buffer,
    existingId: intervention.rapportDocument,
    links: {
      docKind:      'rapport',
      intervention: intervention._id,
      site:         intervention.site?._id || intervention.site || undefined,
    },
    userId,
  })
}

/**
 * Bon d'intervention (intervention ou formation), dans « Bons d'intervention ».
 * Chaque nouvel enregistrement ou impression du bon remplace le fichier rangé :
 * le dossier du client garde la dernière version, celle remise au client.
 */
async function archiveBon(target, source, buffer, userId) {
  const isFormation = source === 'formation'
  const date = isFormation ? target.date : (target.completedDate || target.scheduledDate)
  const ref  = target.bon?.reference
  return archivePdf({
    clientId:   target.client?._id || target.client,
    folderName: BONS_FOLDER_NAME,
    date,
    baseName:   cleanName([
      dayOf(date),
      `Bon d'intervention${ref ? ` n° ${ref}` : ''}${isFormation ? ' (formation)' : ''}`,
      target.site?.name || target.siteName,
    ]),
    buffer,
    existingId: target.bonDocument,
    links: {
      docKind: 'bon',
      site:    target.site?._id || target.site || undefined,
      ...(isFormation ? { formation: target._id } : { intervention: target._id }),
    },
    userId,
  })
}

module.exports = { archiveRapport, archiveBon, RAPPORTS_FOLDER_NAME, BONS_FOLDER_NAME, RAPPORTS_KIND }
