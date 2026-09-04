const router = require('express').Router()
const ctrl   = require('../controllers/controlsController')
const { protect } = require('../middleware/auth')
const { requireAny } = require('../middleware/access')

router.use(protect)
router.use(requireAny(['canManageInterventions']))

router.get('/installation/:installId', ctrl.getByInstallation)
router.get('/client/:clientId',        ctrl.getByClient)
router.post('/',       ctrl.create)
router.put('/:id',     ctrl.update)
router.delete('/:id',  ctrl.remove)

module.exports = router
