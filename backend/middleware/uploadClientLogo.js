const multer = require('multer')
const path   = require('path')
const fs     = require('fs')

const DEST = path.join(__dirname, '..', 'uploads', 'clients')

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Le dossier n'est pas versionné : on le crée au premier envoi.
    fs.mkdirSync(DEST, { recursive: true })
    cb(null, DEST)
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, `client-${req.params.id}-${Date.now()}${ext}`)
  },
})

module.exports = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Images uniquement'), false)
  },
  limits: { fileSize: 5 * 1024 * 1024 },
})
