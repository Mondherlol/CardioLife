const path   = require('path')
const fs     = require('fs')
const fsp    = require('fs/promises')
const crypto = require('crypto')
const multer = require('multer')

const Document    = require('../models/Document')
const AppSettings = require('../models/AppSettings')

const UPLOAD_DIR = path.join(__dirname, '../uploads/documents')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file, cb)  => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname)}`),
})

async function getUploadMiddleware() {
  const settings = await AppSettings.findOne()
  const maxSize  = (settings?.maxFileSizeMB || 50) * 1024 * 1024
  return multer({ storage, limits: { fileSize: maxSize } }).single('file')
}

/* ── Permission check: walks parent chain ─────────────────────── */
async function canAccess(user, doc) {
  if (!doc) return false
  if (user.role === 'superadmin') return true

  let current = doc
  while (current) {
    const perms = current.permissions || {}
    const hasParent = !!current.parent

    if (!perms.inherit || !hasParent) {
      if (!perms.inherit) {
        if (perms.isPublic) return true
        if (perms.roles?.includes(user.role)) return true
        const uid = user._id.toString()
        if (perms.users?.some(u => u.toString() === uid)) return true
        return false
      }
      return true // root + inherit = all authenticated users
    }

    current = await Document.findById(current.parent).lean()
  }
  return true
}

/* ── Endpoints ────────────────────────────────────────────────── */

async function getContents(req, res) {
  const { parent, search } = req.query
  const filter = { isDeleted: false, parent: parent || null }
  if (search) filter.name = { $regex: search, $options: 'i' }

  const items = await Document.find(filter)
    .sort({ type: -1, name: 1 })
    .populate('createdBy', 'fullName')
    .lean()

  const visible = []
  for (const item of items) {
    if (await canAccess(req.user, item)) visible.push(item)
  }
  res.json(visible)
}

async function getTree(req, res) {
  const folders = await Document.find({ type: 'folder', isDeleted: false })
    .select('name parent')
    .sort({ name: 1 })
    .lean()

  const visible = []
  for (const f of folders) {
    if (await canAccess(req.user, f)) visible.push(f)
  }
  res.json(visible)
}

async function getStats(req, res) {
  const [agg, settings] = await Promise.all([
    Document.aggregate([
      { $match: { type: 'file', isDeleted: false } },
      { $group: { _id: null, total: { $sum: '$size' }, count: { $sum: 1 } } },
    ]),
    AppSettings.findOne(),
  ])
  res.json({
    usedBytes:       agg[0]?.total || 0,
    fileCount:       agg[0]?.count || 0,
    maxTotalSpaceMB: settings?.maxTotalSpaceMB || 2048,
    maxFileSizeMB:   settings?.maxFileSizeMB   || 50,
  })
}

async function createFolder(req, res) {
  const { name, parent } = req.body
  if (!name?.trim()) return res.status(422).json({ message: 'Le nom est requis.' })

  if (parent) {
    const parentDoc = await Document.findById(parent).lean()
    if (!parentDoc || parentDoc.isDeleted) return res.status(404).json({ message: 'Dossier parent introuvable.' })
    if (!(await canAccess(req.user, parentDoc))) return res.status(403).json({ message: 'Accès refusé.' })
  }

  const folder = await Document.create({
    name: name.trim(), type: 'folder',
    parent: parent || null, createdBy: req.user._id,
  })
  res.status(201).json(folder)
}

async function uploadFile(req, res) {
  if (!req.file) return res.status(400).json({ message: 'Aucun fichier reçu.' })
  const { parent } = req.body

  const settings = await AppSettings.findOne()
  if (settings?.maxTotalSpaceMB) {
    const [agg] = await Document.aggregate([
      { $match: { type: 'file', isDeleted: false } },
      { $group: { _id: null, total: { $sum: '$size' } } },
    ])
    const used  = agg?.total || 0
    const limit = settings.maxTotalSpaceMB * 1024 * 1024
    if (used + req.file.size > limit) {
      await fsp.unlink(req.file.path).catch(() => {})
      return res.status(400).json({ message: 'Espace de stockage total dépassé.' })
    }
  }

  if (parent) {
    const parentDoc = await Document.findById(parent).lean()
    if (!parentDoc || parentDoc.isDeleted) {
      await fsp.unlink(req.file.path).catch(() => {})
      return res.status(404).json({ message: 'Dossier parent introuvable.' })
    }
    if (!(await canAccess(req.user, parentDoc))) {
      await fsp.unlink(req.file.path).catch(() => {})
      return res.status(403).json({ message: 'Accès refusé.' })
    }
  }

  const rawName = req.file.originalname
  const fileName = Buffer.from(rawName, 'latin1').toString('utf8')

  const doc = await Document.create({
    name: fileName, type: 'file',
    parent: parent || null,
    mimeType: req.file.mimetype,
    size: req.file.size,
    storageKey: req.file.filename,
    createdBy: req.user._id,
  })
  res.status(201).json(doc)
}

async function downloadFile(req, res) {
  const doc = await Document.findById(req.params.id).lean()
  if (!doc || doc.isDeleted || doc.type !== 'file') return res.status(404).json({ message: 'Fichier introuvable.' })
  if (!(await canAccess(req.user, doc))) return res.status(403).json({ message: 'Accès refusé.' })

  const filePath = path.resolve(UPLOAD_DIR, doc.storageKey)
  if (!filePath.startsWith(UPLOAD_DIR)) return res.status(400).json({ message: 'Chemin invalide.' })
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'Fichier physique introuvable.' })

  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(doc.name)}`)
  res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream')
  res.sendFile(filePath)
}

async function rename(req, res) {
  const { name } = req.body
  if (!name?.trim()) return res.status(422).json({ message: 'Le nom est requis.' })

  const doc = await Document.findById(req.params.id)
  if (!doc || doc.isDeleted) return res.status(404).json({ message: 'Document introuvable.' })
  if (!(await canAccess(req.user, doc.toObject()))) return res.status(403).json({ message: 'Accès refusé.' })

  doc.name = name.trim()
  await doc.save()
  res.json(doc)
}

async function move(req, res) {
  const { targetParent } = req.body
  const doc = await Document.findById(req.params.id)
  if (!doc || doc.isDeleted) return res.status(404).json({ message: 'Document introuvable.' })
  if (!(await canAccess(req.user, doc.toObject()))) return res.status(403).json({ message: 'Accès refusé.' })

  if (doc.type === 'folder' && targetParent) {
    let checkId = targetParent
    while (checkId) {
      if (checkId.toString() === doc._id.toString()) return res.status(400).json({ message: 'Impossible de déplacer un dossier dans lui-même.' })
      const p = await Document.findById(checkId).select('parent').lean()
      checkId = p?.parent || null
    }
  }

  if (targetParent) {
    const target = await Document.findById(targetParent).lean()
    if (!target || target.isDeleted || target.type !== 'folder') return res.status(404).json({ message: 'Dossier cible introuvable.' })
    if (!(await canAccess(req.user, target))) return res.status(403).json({ message: 'Accès refusé.' })
  }

  doc.parent = targetParent || null
  await doc.save()
  res.json(doc)
}

async function copyItem(req, res) {
  const { targetParent } = req.body
  const doc = await Document.findById(req.params.id).lean()
  if (!doc || doc.isDeleted) return res.status(404).json({ message: 'Document introuvable.' })
  if (!(await canAccess(req.user, doc))) return res.status(403).json({ message: 'Accès refusé.' })

  if (targetParent) {
    const target = await Document.findById(targetParent).lean()
    if (!target || target.isDeleted || target.type !== 'folder') return res.status(404).json({ message: 'Dossier cible introuvable.' })
    if (!(await canAccess(req.user, target))) return res.status(403).json({ message: 'Accès refusé.' })
  }

  const copied = await deepCopy(doc, targetParent || null, req.user._id)
  res.status(201).json(copied)
}

async function deepCopy(doc, newParent, userId) {
  if (doc.type === 'file') {
    const newKey = `${crypto.randomUUID()}${path.extname(doc.name)}`
    await fsp.copyFile(path.join(UPLOAD_DIR, doc.storageKey), path.join(UPLOAD_DIR, newKey))
    return Document.create({
      name: `${doc.name} (copie)`, type: 'file', parent: newParent,
      mimeType: doc.mimeType, size: doc.size, storageKey: newKey, createdBy: userId,
    })
  }
  const newFolder = await Document.create({
    name: `${doc.name} (copie)`, type: 'folder', parent: newParent, createdBy: userId,
  })
  const children = await Document.find({ parent: doc._id, isDeleted: false }).lean()
  for (const child of children) await deepCopy(child, newFolder._id, userId)
  return newFolder
}

async function updatePermissions(req, res) {
  if (!['admin', 'superadmin'].includes(req.user.role)) {
    return res.status(403).json({ message: 'Seuls les admins peuvent modifier les permissions.' })
  }
  const doc = await Document.findById(req.params.id)
  if (!doc || doc.isDeleted) return res.status(404).json({ message: 'Document introuvable.' })

  const { inherit, isPublic, roles, users } = req.body
  doc.permissions = { inherit: !!inherit, isPublic: !!isPublic, roles: roles || [], users: users || [] }
  await doc.save()

  const populated = await Document.findById(doc._id).populate('permissions.users', 'fullName username role')
  res.json(populated)
}

async function deleteItem(req, res) {
  const doc = await Document.findById(req.params.id)
  if (!doc || doc.isDeleted) return res.status(404).json({ message: 'Document introuvable.' })
  if (!(await canAccess(req.user, doc.toObject()))) return res.status(403).json({ message: 'Accès refusé.' })

  await softDelete(doc)
  res.json({ message: 'Supprimé.' })
}

async function softDelete(doc) {
  doc.isDeleted = true
  await doc.save()
  if (doc.type === 'folder') {
    const children = await Document.find({ parent: doc._id, isDeleted: false })
    for (const child of children) await softDelete(child)
  }
}

module.exports = {
  getUploadMiddleware,
  getContents, getTree, getStats,
  createFolder, uploadFile, downloadFile,
  rename, move, copyItem, updatePermissions, deleteItem,
}
