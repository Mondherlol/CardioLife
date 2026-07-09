const Document = require('../models/Document')
const Client   = require('../models/Client')

const CLIENTS_ROOT_NAME = 'Clients'

/* Trouve (ou crée) le dossier système "Clients/<NomDuClient>" et le référence
   sur le client, pour que l'onglet Documents du client et DocumentsPage
   pointent toujours vers le même dossier. */
async function getOrCreateClientFolder(client, userId) {
  let root = await Document.findOne({ name: CLIENTS_ROOT_NAME, parent: null, type: 'folder', isDeleted: false })
  if (!root) {
    root = await Document.create({ name: CLIENTS_ROOT_NAME, type: 'folder', parent: null, isSystem: true, createdBy: userId })
  }

  if (client.documentsFolder) {
    const existing = await Document.findOne({ _id: client.documentsFolder, isDeleted: false })
    if (existing) return existing
  }

  let folder = await Document.findOne({ name: client.name, parent: root._id, type: 'folder', isDeleted: false })
  if (!folder) {
    folder = await Document.create({ name: client.name, type: 'folder', parent: root._id, isSystem: true, createdBy: userId })
  }

  if (String(client.documentsFolder || '') !== String(folder._id)) {
    await Client.findByIdAndUpdate(client._id, { documentsFolder: folder._id })
  }

  return folder
}

module.exports = { getOrCreateClientFolder, CLIENTS_ROOT_NAME }
