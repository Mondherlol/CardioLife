const router = require('express').Router()
const multer = require('multer')

// Bon PDF généré par le navigateur : gardé en mémoire, le contrôleur le range.
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 40 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'application/pdf'),
})
const ctrl   = require('../controllers/formationsController')
const { protect } = require('../middleware/auth')
const { requireAnyPermission } = require('../middleware/permissions')

router.use(protect)
// Accessible avec le droit dédié "Formations" OU l'ancien droit "Clients"
// (pour ne pas retirer l'accès aux utilisateurs qui l'utilisaient déjà via la fiche client).
router.use(requireAnyPermission(['canManageFormations', 'canManageClients']))

router.get('/',                          ctrl.getAll)
router.get('/client/:clientId',          ctrl.getByClient)
router.get('/site/:siteId',              ctrl.getBySite)
router.post('/',                         ctrl.create)
router.put('/:id',                       ctrl.update)
// Bon d'intervention de la séance (même écran que celui d'une intervention).
router.get('/:id/bon',                   ctrl.getBon)
router.patch('/:id/bon',                 ctrl.saveBon)
// PDF du bon rangé dans les documents du client.
router.post('/:id/bon-pdf', (req, res, next) => {
  pdfUpload.single('file')(req, res, err => {
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ message: 'PDF trop volumineux.' })
    if (err) return res.status(400).json({ message: err.message })
    next()
  })
}, ctrl.saveBonPdf)
router.patch('/:id/attestation',         ctrl.toggleAttestation)
router.post('/:id/documents',            ctrl.addDocuments)
router.delete('/:id/documents/:docId',   ctrl.removeDocument)
router.delete('/:id',                    ctrl.remove)

module.exports = router
