const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../controllers/productCategoriesController')
const { protect }           = require('../middleware/auth')
const { requirePermission } = require('../middleware/permissions')

const categoryValidation = [
  body('name').trim().notEmpty().withMessage('Le nom de la catégorie est requis.'),
]

router.use(protect)

// Lecture accessible à tout utilisateur connecté : les catégories servent aussi
// à qualifier les DEA côté fiches clients.
router.get('/', ctrl.getAll)

router.use(requirePermission('canManageStock'))

router.post('/',        categoryValidation, ctrl.create)
router.put('/reorder',  ctrl.reorder)
router.put('/:id',      categoryValidation, ctrl.update)
router.delete('/:id',   ctrl.remove)

module.exports = router
