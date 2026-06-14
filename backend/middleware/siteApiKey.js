function requireSiteApiKey(req, res, next) {
  const expected = process.env.PUBLIC_SITE_API_KEY
  if (!expected) return next()

  const provided = req.get('x-site-api-key')
  if (provided === expected) return next()

  return res.status(401).json({ message: 'Cle API site invalide ou manquante.' })
}

module.exports = { requireSiteApiKey }
