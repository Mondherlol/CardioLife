const AppSettings = require('../models/AppSettings')

async function get(req, res) {
  const settings = await AppSettings.findOne() ?? await AppSettings.create({})
  res.json(settings)
}

async function update(req, res) {
  const { maxFileSizeMB, maxTotalSpaceMB, defaultUploadFolderId } = req.body
  let settings = await AppSettings.findOne()
  if (!settings) settings = new AppSettings()
  if (maxFileSizeMB   != null) settings.maxFileSizeMB   = Number(maxFileSizeMB)
  if (maxTotalSpaceMB != null) settings.maxTotalSpaceMB = Number(maxTotalSpaceMB)
  if (defaultUploadFolderId !== undefined) settings.defaultUploadFolderId = defaultUploadFolderId || null
  await settings.save()
  res.json(settings)
}

module.exports = { get, update }
