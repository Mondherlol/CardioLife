const router = require('express').Router()
const ctrl   = require('../controllers/formationsController')
const { protect } = require('../middleware/auth')

router.use(protect)

router.get('/client/:clientId',          ctrl.getByClient)
router.post('/',                         ctrl.create)
router.put('/:id',                       ctrl.update)
router.patch('/:id/attestation',         ctrl.toggleAttestation)
router.post('/:id/documents',            ctrl.addDocuments)
router.delete('/:id/documents/:docId',   ctrl.removeDocument)
router.delete('/:id',                    ctrl.remove)

module.exports = router
