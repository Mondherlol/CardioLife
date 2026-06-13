const router = require('express').Router()
const ctrl   = require('../controllers/appSettingsController')
const { protect }                  = require('../middleware/auth')
const { requireAdminOrSuperAdmin } = require('../middleware/permissions')

router.use(protect)
router.get('/', ctrl.get)
router.put('/', requireAdminOrSuperAdmin, ctrl.update)

module.exports = router
