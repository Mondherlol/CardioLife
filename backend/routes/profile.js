const router   = require('express').Router()
const ctrl     = require('../controllers/profileController')
const { protect } = require('../middleware/auth')
const uploadAv = require('../middleware/uploadAvatar')

router.use(protect)

router.get('/',           ctrl.getProfile)
router.patch('/',         ctrl.updateProfile)
router.post('/password',  ctrl.changePassword)
router.post('/avatar',    uploadAv.single('avatar'), ctrl.uploadAvatar)
router.delete('/avatar',  ctrl.deleteAvatar)

module.exports = router
