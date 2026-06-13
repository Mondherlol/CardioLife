const router = require('express').Router()
const ctrl   = require('../controllers/controlsController')
const { protect } = require('../middleware/auth')

router.use(protect)

router.get('/installation/:installId', ctrl.getByInstallation)
router.get('/client/:clientId',        ctrl.getByClient)
router.post('/',       ctrl.create)
router.put('/:id',     ctrl.update)
router.delete('/:id',  ctrl.remove)

module.exports = router
