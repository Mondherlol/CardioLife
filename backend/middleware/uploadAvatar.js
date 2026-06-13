const multer = require('multer')
const path   = require('path')

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'uploads', 'avatars'))
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, `av-${req.user._id}-${Date.now()}${ext}`)
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
