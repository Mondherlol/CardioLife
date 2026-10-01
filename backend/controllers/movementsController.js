const StockMovement = require('../models/StockMovement')
const { pageParams, pageResult } = require('../utils/paging')

const POPULATE = [
  { path: 'product',   select: 'name reference category' },
  { path: 'createdBy', select: 'username fullName'       },
]

async function getAll(req, res) {
  const { product, type, category } = req.query
  const paging = pageParams(req.query)

  const filter = {}
  if (product) filter.product = product
  if (type)    filter.type = type

  // `_id` départage les mouvements d'une même seconde : sans lui, un lot chargé
  // au défilement pourrait en répéter ou en sauter un.
  const sort = { createdAt: -1, _id: -1 }
  let movements, total

  if (category) {
    // Filtre par catégorie du produit : il faut passer par le produit. Le
    // décompte et le lot sortent de la même requête plutôt que de tout lire
    // une première fois pour compter.
    const [res] = await StockMovement.aggregate([
      { $lookup: { from: 'products', localField: 'product', foreignField: '_id', as: 'productDoc' } },
      { $unwind: '$productDoc' },
      { $match: { 'productDoc.category': category, ...filter } },
      { $project: { productDoc: 0 } },
      { $sort: sort },
      {
        $facet: {
          total: [{ $count: 'n' }],
          data:  [{ $skip: paging.skip }, { $limit: paging.limit }],
        },
      },
    ])
    total     = res?.total?.[0]?.n || 0
    movements = await StockMovement.populate(res?.data || [], POPULATE)
  } else {
    ;[total, movements] = await Promise.all([
      StockMovement.countDocuments(filter),
      StockMovement.find(filter)
        .sort(sort)
        .skip(paging.skip)
        .limit(paging.limit)
        .populate(POPULATE),
    ])
  }

  res.json(pageResult(movements, total, paging))
}

module.exports = { getAll }
