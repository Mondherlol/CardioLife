const router = require('express').Router()
const ctrl   = require('../controllers/installationsController')
const { protect }            = require('../middleware/auth')
const { requirePermission }  = require('../middleware/permissions')

router.use(protect, requirePermission('canManageDevices'))

router.get('/',    ctrl.getAll)
router.get('/:id', ctrl.getById)
router.post('/',   ctrl.create)
router.put('/:id', ctrl.update)
router.delete('/:id', ctrl.remove)

module.exports = router
