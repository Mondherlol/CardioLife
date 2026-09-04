const router = require('express').Router()
const { protect } = require('../middleware/auth')
const { requireModule } = require('../middleware/access')
const { getDashboard } = require('../controllers/dashboardController')

router.use(protect)
router.use(requireModule('dashboard'))
router.get('/', getDashboard)

module.exports = router
