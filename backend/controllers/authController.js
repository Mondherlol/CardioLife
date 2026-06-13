const jwt  = require('jsonwebtoken')
const User = require('../models/User')

function signToken(id) {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  })
}

async function login(req, res) {
  const { username, password } = req.body

  if (!username || !password) {
    return res.status(400).json({ message: 'Identifiant et mot de passe requis.' })
  }

  const user = await User.findOne({ username }).select('+password')

  if (!user || !user.isActive) {
    return res.status(401).json({ message: 'Identifiants incorrects.' })
  }

  const valid = await user.comparePassword(password)
  if (!valid) {
    return res.status(401).json({ message: 'Identifiants incorrects.' })
  }

  const token = signToken(user._id)

  res.json({
    token,
    user: {
      id:          user._id,
      username:    user.username,
      fullName:    user.fullName,
      email:       user.email,
      role:        user.role,
      permissions: user.permissions,
    },
  })
}

async function me(req, res) {
  res.json({
    user: {
      id:          req.user._id,
      username:    req.user.username,
      fullName:    req.user.fullName,
      email:       req.user.email,
      role:        req.user.role,
      permissions: req.user.permissions,
    },
  })
}

module.exports = { login, me }
