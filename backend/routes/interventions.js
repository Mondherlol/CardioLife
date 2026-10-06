const router  = require('express').Router()
const ctrl    = require('../controllers/interventionsController')
const { protect } = require('../middleware/auth')
const { requireAnyOrRead } = require('../middleware/access')
const multer   = require('multer')
const uploadIv = require('../middleware/uploadIntervention')

// Rapport PDF généré par le navigateur : gardé en mémoire, le contrôleur le range.
const uploadPdf = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 40 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'application/pdf'),
})

router.use(protect)
// Lecture ouverte au droit Clients : la fiche client liste ses contrôles.
router.use(requireAnyOrRead(['canManageInterventions'], ['canManageClients']))

router.get('/search-installations', ctrl.searchInstallations)

router.get('/',    ctrl.getAll)
router.post('/',   ctrl.create)
router.get('/:id', ctrl.getOne)
router.put('/:id', ctrl.update)

// Le démarrage est une action à part : la checklist reste en lecture seule
// tant qu'il n'a pas eu lieu.
router.patch('/:id/start', ctrl.startIntervention)

router.patch('/:id/rapport', ctrl.submitRapport)
router.patch('/:id/fiche',   ctrl.saveFiche)
router.delete('/:id/fiche/:deaId', ctrl.removeFiche)
router.patch('/:id/close',   ctrl.closeIntervention)
/* Oubli constaté juste après la clôture : la visite se rouvre, et la
   réouverture apparaît dans l'historique. */
router.patch('/:id/reopen',  ctrl.reopenIntervention)
/* Batterie / électrodes montées sur le DAE, identifiées depuis la checklist. */
router.put('/:id/dea-items/:kind', ctrl.saveDeaItems)
/* Formation des agents : effectuée ou reportée, tranché pendant la visite. */
router.patch('/:id/formation', ctrl.saveFormation)
/* Bon d'intervention : nature du passage et signature du client. */
router.patch('/:id/bon', ctrl.saveBon)

/* Rapport PDF rangé dans « Documents » du client, après la clôture. */
router.post('/:id/rapport-pdf', (req, res, next) => {
  uploadPdf.single('file')(req, res, err => {
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ message: 'Rapport trop volumineux.' })
    if (err) return res.status(400).json({ message: err.message })
    next()
  })
}, ctrl.saveRapportPdf)

router.post('/:id/photo',            uploadIv.single('photo'), ctrl.uploadFichePhoto)
router.delete('/:id/photo/:filename', ctrl.deleteFichePhoto)

router.delete('/:id', ctrl.remove)

module.exports = router
