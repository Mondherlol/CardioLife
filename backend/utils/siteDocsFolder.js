const Document = require('../models/Document')
const Client   = require('../models/Client')
const Site     = require('../models/Site')
const { getOrCreateClientFolder } = require('./clientDocsFolder')

const SITES_FOLDER_NAME = 'Sites'

/* Trouve (ou crée) le dossier système "Clients/<Client>/Sites/<Site>".
   Même principe que le dossier du client : la fiche du site et DocumentsPage
   pointent toujours vers le même dossier. */
async function getOrCreateSiteFolder(site, userId) {
  if (site.documentsFolder) {
    const existing = await Document.findOne({ _id: site.documentsFolder, isDeleted: false })
    if (existing) return existing
  }

  const client = site.client?.name
    ? site.client
    : await Client.findById(site.client?._id || site.client)
  if (!client) throw new Error('Client du site introuvable.')

  const clientFolder = await getOrCreateClientFolder(client, userId)

  let sitesFolder = await Document.findOne({
    name: SITES_FOLDER_NAME, parent: clientFolder._id, type: 'folder', isDeleted: false,
  })
  if (!sitesFolder) {
    sitesFolder = await Document.create({
      name: SITES_FOLDER_NAME, type: 'folder', parent: clientFolder._id,
      isSystem: true, createdBy: userId,
    })
  }

  let folder = await Document.findOne({
    name: site.name, parent: sitesFolder._id, type: 'folder', isDeleted: false,
  })
  if (!folder) {
    folder = await Document.create({
      name: site.name, type: 'folder', parent: sitesFolder._id,
      isSystem: true, createdBy: userId,
    })
  }

  if (String(site.documentsFolder || '') !== String(folder._id)) {
    await Site.findByIdAndUpdate(site._id, { documentsFolder: folder._id })
  }

  return folder
}

module.exports = { getOrCreateSiteFolder, SITES_FOLDER_NAME }
