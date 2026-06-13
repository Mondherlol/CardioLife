const jwt  = require('jsonwebtoken')
const User = require('../models/User')

async function protect(req, res, next) {
  const header = req.headers.authorization

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Accès non autorisé. Token manquant.' })
  }

  const token = header.split(' ')[1]

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const user = await User.findById(decoded.id).select('-password')

    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Utilisateur introuvable ou désactivé.' })
    }

    req.user = user
    next()
  } catch {
    res.status(401).json({ message: 'Token invalide ou expiré.' })
  }
}

module.exports = { protect }
