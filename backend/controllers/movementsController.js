const StockMovement = require('../models/StockMovement')

async function getAll(req, res) {
  const { page = 1, limit = 20, product, type, category } = req.query

  const filter = {}
  if (product) filter.product = product
  if (type)    filter.type = type

  const skip  = (Number(page) - 1) * Number(limit)

  // Si filtre catégorie demandé on filtre via lookup, sinon requête simple
  let movements, total

  if (category) {
    // Aggregation pour filtrer par catégorie du produit
    const pipeline = [
      {
        $lookup: {
          from:         'products',
          localField:   'product',
          foreignField: '_id',
          as:           'productDoc',
        },
      },
      { $unwind: '$productDoc' },
      { $match: { 'productDoc.category': category, ...filter } },
      { $sort: { createdAt: -1 } },
    ]
    const all = await StockMovement.aggregate([...pipeline])
    total = all.length

    const paginated = await StockMovement.aggregate([
      ...pipeline,
      { $skip: skip },
      { $limit: Number(limit) },
    ])

    movements = await StockMovement.populate(paginated, [
      { path: 'product',   select: 'name reference category' },
      { path: 'createdBy', select: 'username fullName'       },
    ])
  } else {
    total = await StockMovement.countDocuments(filter)
    movements = await StockMovement.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate('product',   'name reference category')
      .populate('createdBy', 'username fullName')
  }

  res.json({
    data:       movements,
    total,
    page:       Number(page),
    totalPages: Math.ceil(total / Number(limit)),
  })
}

module.exports = { getAll }
