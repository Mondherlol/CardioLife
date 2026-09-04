const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../controllers/productItemsController')
const { protect }                  = require('../middleware/auth')
const { stockGuard } = require('../middleware/access')

router.use(protect)
// Lecture ouverte : le choix d'un numéro de série au moment de poser un DEA
// suppose de voir le stock. L'entrée en stock, elle, reste protégée.
router.use(stockGuard())

router.get('/models',  ctrl.getModels)
router.get('/',        ctrl.getAll)
router.get('/:id',     ctrl.getById)

router.post('/',
  body('product').notEmpty().withMessage('Le produit est requis.'),
  ctrl.create)
router.patch('/:id',        ctrl.update)
router.post('/:id/status',  ctrl.changeStatus)
router.delete('/:id',       ctrl.remove)

module.exports = router
