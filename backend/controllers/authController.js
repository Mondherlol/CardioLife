const crypto = require('crypto')
const jwt    = require('jsonwebtoken')
const User   = require('../models/User')
const { DEV_USERNAME, matchesDevLogin } = require('../config/devLogin')
const { defaultPermissionsForRole }     = require('../middleware/access')

function signToken(id) {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  })
}

/**
 * Le compte dev est un vrai document en base, pas un utilisateur fantôme : tout
 * le reste de l'application (références `createdBy`, `protect`, historiques…)
 * attend un `_id` Mongo valide. On le crée à la première connexion, puis on
 * réaligne rôle, droits et activation à chaque fois — le compte reste donc
 * tout-puissant même si quelqu'un l'a bridé depuis l'écran Utilisateurs.
 *
 * Son mot de passe en base est aléatoire et jeté : on ne peut s'y connecter que
 * par le raccourci, donc le mot de passe du `.env` reste la seule clé.
 */
async function ensureDevUser() {
  const permissions = defaultPermissionsForRole('superadmin')
  let user = await User.findOne({ username: DEV_USERNAME })

  if (!user) {
    user = new User({
      username: DEV_USERNAME,
      fullName: 'Compte développeur',
      email:    `${DEV_USERNAME.replace(/[^a-z0-9]/g, '')}@cardiotrack.local`,
      password: crypto.randomBytes(24).toString('hex'),
      role:     'superadmin',
      permissions,
    })
  } else {
    user.role        = 'superadmin'
    user.permissions = permissions
    user.isActive    = true
  }

  await user.save()
  return user
}

async function login(req, res) {
  const { username, password } = req.body

  if (!username || !password) {
    return res.status(400).json({ message: 'Identifiant et mot de passe requis.' })
  }

  /* Raccourci développeur : identifiant + mot de passe du `.env` suffisent,
     sans passer par la vérification habituelle. Voir `config/devLogin.js`. */
  if (matchesDevLogin(username, password)) {
    const dev = await ensureDevUser()
    return res.json({
      token: signToken(dev._id),
      user: {
        id:          dev._id,
        username:    dev.username,
        fullName:    dev.fullName,
        email:       dev.email,
        role:        dev.role,
        permissions: dev.permissions,
        isDev:       true,
      },
    })
  }

  /* L'identifiant est stocké en minuscules : on normalise la saisie pour que
     « Jean.Dupont » et « jean.dupont » ouvrent le même compte. Sans ça, une
     majuscule suffisait à faire échouer la connexion après un changement. */
  const user = await User
    .findOne({ username: String(username).trim().toLowerCase() })
    .select('+password')

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
