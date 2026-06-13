const router = require('express').Router()
const ctrl   = require('../controllers/documentsController')
const { protect } = require('../middleware/auth')

router.use(protect)

router.get('/tree',  ctrl.getTree)
router.get('/stats', ctrl.getStats)
router.get('/',      ctrl.getContents)
router.post('/folder', ctrl.createFolder)

router.post('/upload', async (req, res, next) => {
  try {
    const mw = await ctrl.getUploadMiddleware()
    mw(req, res, err => {
      if (err?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ message: 'Fichier trop volumineux.' })
      if (err) return res.status(400).json({ message: err.message || 'Erreur lors de l\'upload.' })
      next()
    })
  } catch (e) { next(e) }
}, ctrl.uploadFile)

router.get('/:id/download',     ctrl.downloadFile)
router.put('/:id/rename',       ctrl.rename)
router.put('/:id/move',         ctrl.move)
router.post('/:id/copy',        ctrl.copyItem)
router.put('/:id/permissions',  ctrl.updatePermissions)
router.delete('/:id',           ctrl.deleteItem)

module.exports = router
