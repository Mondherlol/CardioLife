const router = require('express').Router()
const ctrl   = require('../controllers/maintenanceController')
const { protect }          = require('../middleware/auth')
const { requireSuperAdmin } = require('../middleware/permissions')

/* Reprises de données — elles réécrivent du métier, super admin uniquement. */
router.use(protect, requireSuperAdmin)

router.get('/',        ctrl.list)
router.post('/:task',  ctrl.run)

module.exports = router
