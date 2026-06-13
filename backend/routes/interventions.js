const router  = require('express').Router()
const ctrl    = require('../controllers/interventionsController')
const { protect } = require('../middleware/auth')
const uploadIv = require('../middleware/uploadIntervention')

router.use(protect)

router.get('/search-installations', ctrl.searchInstallations)

router.get('/',    ctrl.getAll)
router.post('/',   ctrl.create)
router.get('/:id', ctrl.getOne)
router.put('/:id', ctrl.update)

router.patch('/:id/rapport', ctrl.submitRapport)
router.patch('/:id/fiche',   ctrl.saveFiche)
router.patch('/:id/close',   ctrl.closeIntervention)

router.post('/:id/photo',            uploadIv.single('photo'), ctrl.uploadFichePhoto)
router.delete('/:id/photo/:filename', ctrl.deleteFichePhoto)

router.delete('/:id', ctrl.remove)

module.exports = router
