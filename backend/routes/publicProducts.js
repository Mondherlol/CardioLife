const router = require('express').Router()
const ctrl = require('../controllers/publicProductsController')
const { requireSiteApiKey } = require('../middleware/siteApiKey')

router.use(requireSiteApiKey)

router.get('/', ctrl.getAll)
router.get('/:id', ctrl.getById)

module.exports = router
