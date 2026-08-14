const router = require('express').Router()
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
router.patch('/:id/attestation',         ctrl.toggleAttestation)
router.post('/:id/documents',            ctrl.addDocuments)
router.delete('/:id/documents/:docId',   ctrl.removeDocument)
router.delete('/:id',                    ctrl.remove)

module.exports = router
