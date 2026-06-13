/**
 * Importeur CardioLife -> CardioTrack.
 *
 * Usage:
 *   node scripts/scrapeCardiolifeProducts.js
 *   node scripts/scrapeCardiolifeProducts.js --dry-run --max=1
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })

const fs = require('fs/promises')
const path = require('path')
const mongoose = require('mongoose')
const cheerio = require('cheerio')
const Product = require('../models/Product')

const SITE_URL = 'https://cardiolife.tn'
const START_URL = `${SITE_URL}/nos-produits-2/`
const PRODUCTS_DIR = path.join(__dirname, '..', 'uploads', 'products')

function parseArgs(argv) {
  return argv.reduce((options, arg) => {
    if (arg === '--dry-run') options.dryRun = true
    if (arg === '--skip-images') options.skipImages = true
    if (arg.startsWith('--max=')) options.max = Number(arg.split('=')[1]) || 0
    if (arg.startsWith('--start-url=')) options.startUrl = arg.split('=')[1]
    return options
  }, {
    dryRun: false,
    skipImages: false,
    max: 0,
    startUrl: START_URL,
  })
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function cleanText(value) {
  return (value || '')
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim()
}

function htmlToText(html) {
  if (!html) return ''
  return cleanText(
    html
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/h\d>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ')
  )
}

function normalizeRichTextHtml(html) {
  if (!html) return ''

  const $ = cheerio.load(`<div id="wrap">${html}</div>`, null, false)
  const wrap = $('#wrap')
  wrap.find('h1, h2, h3').each((_, element) => {
    if (cleanText($(element).text()).toLowerCase() === 'description') {
      $(element).remove()
    }
  })

  return cleanText(wrap.html() || '') ? wrap.html().trim() : ''
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function inferCategory({ title, categories, text, classes = [] }) {
  const haystack = `${title} ${categories.join(' ')} ${text}`.toLowerCase()
  const classList = classes.join(' ').toLowerCase()

  if (classList.includes('product_cat-defibrillateurs')) {
    return 'defibrillateur'
  }
  if (classList.includes('product_cat-armoire-et-support')) {
    return 'boitier'
  }
  if (classList.includes('product_cat-sacoche-de-transports')) {
    return 'accessoire'
  }
  if (classList.includes('product_cat-signaletiques')) {
    return 'signaletique'
  }
  if (classList.includes('product_cat-materiel-de-formation')) {
    return 'autre'
  }
  if (classList.includes('product_cat-electrodes-et-batteries')) {
    if (/(pile|batterie|battery|cr123|lithium)/i.test(haystack)) {
      return 'batterie'
    }
    if (/pediat|enfant|child|junior/i.test(haystack)) {
      return /electrode|pads|padz/i.test(haystack) ? 'electrodes_enfant' : 'autre'
    }
    if (/electrode|padz|electrodes|pads/i.test(haystack)) {
      return 'electrodes_adulte'
    }
    return 'autre'
  }

  if (/(pile|batterie|battery|cr123|lithium)/i.test(haystack)) {
    return 'batterie'
  }
  if (/pediat|enfant|child|junior/i.test(haystack)) {
    return /electrode|pads|padz/i.test(haystack) ? 'electrodes_enfant' : 'autre'
  }
  if (/electrode|padz|electrodes|pads/i.test(haystack)) {
    return 'electrodes_adulte'
  }
  if (/(kit de secours|premiers secours|first aid)/i.test(haystack)) {
    return 'kit_secours'
  }
  if (/(defibrillateur|dae|aed|zoll|powerheart|cardiac science)/i.test(haystack)) {
    return 'defibrillateur'
  }
  return 'autre'
}

function inferBrand(title, text) {
  const haystack = `${title} ${text}`.toLowerCase()
  if (/powerheart|cardiac science/i.test(haystack)) return 'Cardiac Science'
  if (/\bzoll\b/i.test(haystack)) return 'ZOLL'
  if (/aivia/i.test(haystack)) return 'AIVIA'
  if (/duracell/i.test(haystack)) return 'DURACELL'
  if (/varta/i.test(haystack)) return 'VARTA'
  return 'CardioLife'
}

function inferDeviceMode(title, text, classes = []) {
  const haystack = `${title} ${text}`.toLowerCase()
  const classList = classes.join(' ').toLowerCase()

  if (classList.includes('product_cat-semi-automatique')) return 'semi-automatique'
  if (classList.includes('product_cat-automatique')) return 'automatique'
  if (haystack.includes('semi-automatique') || haystack.includes('semi automatique')) return 'semi-automatique'
  if (haystack.includes('automatique')) return 'automatique'
  return undefined
}

function buildReference(url) {
  const slug = new URL(url).pathname.split('/').filter(Boolean).pop() || slugify(url)
  return `cardiolife:${slug}`
}

function normalizeProductUrl(url) {
  return new URL(url, SITE_URL).toString()
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; CardioTrackBot/1.0; +https://cardiolife.tn)',
      accept: 'text/html,application/xhtml+xml',
    },
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} sur ${url}`)
  }
  return response.text()
}

async function fetchBinary(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; CardioTrackBot/1.0; +https://cardiolife.tn)',
    },
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} sur ${url}`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  return { buffer, contentType: response.headers.get('content-type') || '' }
}

function extensionFromUrl(url, contentType) {
  const pathnameExt = path.extname(new URL(url).pathname)
  if (pathnameExt) return pathnameExt.toLowerCase()
  if (contentType.includes('png')) return '.png'
  if (contentType.includes('webp')) return '.webp'
  if (contentType.includes('gif')) return '.gif'
  return '.jpg'
}

async function downloadImage(url, slug, index) {
  const { buffer, contentType } = await fetchBinary(url)
  const ext = extensionFromUrl(url, contentType)
  const filename = `${slug}-${index + 1}${ext}`
  const filePath = path.join(PRODUCTS_DIR, filename)

  try {
    await fs.access(filePath)
  } catch {
    await fs.writeFile(filePath, buffer)
  }

  return filename
}

function parseListingPage(html) {
  const $ = cheerio.load(html)
  const cards = []

  $('ul.products > li.product').each((_, element) => {
    const card = $(element)
    const link = card.find('h3.product-title a').attr('href')
    const title = cleanText(card.find('h3.product-title a').text())
    if (!link || !title) return

    const imageUrls = unique(
      card
        .find('.product-main-image img')
        .map((__, img) => $(img).attr('src') || $(img).attr('data-src') || $(img).attr('data-large_image'))
        .get()
        .map(normalizeProductUrl)
    )

    cards.push({
      url: normalizeProductUrl(link),
      title,
      imageUrls,
      classes: (card.attr('class') || '').split(/\s+/).filter(Boolean),
    })
  })

  const nextUrl = $('.woocommerce-pagination .next.page-numbers').attr('href')
  return {
    cards,
    nextUrl: nextUrl ? normalizeProductUrl(nextUrl) : null,
  }
}

function parseProductPage(html, classes = []) {
  const $ = cheerio.load(html)
  const title = cleanText($('h1.product_title').text()) || cleanText($('meta[property="og:title"]').attr('content') || '')
  const shortDescriptionHtml = normalizeRichTextHtml($('.woocommerce-product-details__short-description').html())
  const longDescriptionHtml = normalizeRichTextHtml($('#tab-description').html())
  const shortDescription = htmlToText(shortDescriptionHtml)
  const longDescription = htmlToText(longDescriptionHtml)
  const ogImage = $('meta[property="og:image"]').attr('content')
  const galleryImages = unique(
    $('.woocommerce-product-gallery__image a[href], .woocommerce-product-gallery__image img')
      .map((_, element) => $(element).attr('href') || $(element).attr('data-large_image') || $(element).attr('src'))
      .get()
      .map(normalizeProductUrl)
  )

  const categories = unique(
    $('span.posted_in a, .product_meta a[rel="tag"]')
      .map((_, element) => cleanText($(element).text()))
      .get()
  )

  const descriptionText = [shortDescription, longDescription].filter(Boolean).join('\n\n')
  const category = inferCategory({ title, categories, text: descriptionText, classes })
  const brand = inferBrand(title, descriptionText)
  const deviceMode = inferDeviceMode(title, descriptionText, classes)
  const reference = buildReference($('link[rel="canonical"]').attr('href') || $('meta[property="og:url"]').attr('content') || '')

  return {
    title,
    description: [shortDescriptionHtml, longDescriptionHtml].filter(Boolean).join('\n'),
    shortDescription,
    longDescription,
    descriptionText,
    categories,
    imageUrls: unique([ogImage, ...galleryImages]),
    category,
    brand,
    deviceMode,
    reference,
  }
}

async function scrapeAllProducts(startUrl) {
  const products = []
  const seen = new Set()
  let pageUrl = startUrl

  while (pageUrl) {
    console.log(`Lecture de la page: ${pageUrl}`)
    const html = await fetchHtml(pageUrl)
    const { cards, nextUrl } = parseListingPage(html)

    for (const card of cards) {
      if (seen.has(card.url)) continue
      seen.add(card.url)
      products.push(card)
    }

    pageUrl = nextUrl
  }

  return products
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const listingProducts = await scrapeAllProducts(options.startUrl)
  const selectedProducts = options.max > 0 ? listingProducts.slice(0, options.max) : listingProducts

  console.log(`Produits trouvés: ${listingProducts.length}`)
  console.log(`Produits traités: ${selectedProducts.length}`)

  if (options.dryRun) {
    for (const card of selectedProducts.slice(0, 5)) {
      const productPage = await fetchHtml(card.url)
      const parsed = parseProductPage(productPage, card.classes)
      console.log(JSON.stringify({
        title: parsed.title,
        reference: parsed.reference,
        category: parsed.category,
        brand: parsed.brand,
        deviceMode: parsed.deviceMode,
        imageCount: parsed.imageUrls.length,
        descriptionPreview: parsed.description.slice(0, 120),
      }, null, 2))
    }
    return
  }

  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI manquant dans backend/.env')
  }

  await fs.mkdir(PRODUCTS_DIR, { recursive: true })
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('MongoDB connecté.')

  let created = 0
  let updated = 0

  try {
    for (const card of selectedProducts) {
      const productHtml = await fetchHtml(card.url)
      const parsed = parseProductPage(productHtml, card.classes)

      const fallbackSlug = slugify(parsed.title || card.title || card.url)
      const slug = parsed.reference.replace(/^cardiolife:/, '') || fallbackSlug
      const imageUrls = unique([...card.imageUrls, ...parsed.imageUrls])
      const images = options.skipImages
        ? []
        : await Promise.all(imageUrls.map((url, index) => downloadImage(url, slug, index)))

      const payload = {
        name: parsed.title || card.title,
        reference: parsed.reference || `cardiolife:${slug}`,
        brand: parsed.brand,
        description: parsed.description || undefined,
        category: parsed.category,
        deviceMode: parsed.deviceMode,
        requiresSerialNumber: parsed.category === 'defibrillateur',
        requiresLotNumber: ['batterie', 'electrodes_adulte', 'electrodes_enfant', 'kit_secours'].includes(parsed.category),
        stock: 0,
        alertThreshold: 5,
        supplier: 'CardioLife Tunisie',
        images,
        isActive: true,
      }

      const existing = await Product.findOne({ reference: payload.reference })
      if (existing) {
        await Product.updateOne({ _id: existing._id }, { $set: payload, $unset: { notes: 1 } })
        updated += 1
        console.log(`MAJ: ${payload.name}`)
      } else {
        await Product.create(payload)
        created += 1
        console.log(`CRÉÉ: ${payload.name}`)
      }
    }
  } finally {
    await mongoose.disconnect().catch(() => {})
  }

  console.log(`Import terminé. Créés: ${created}, mis à jour: ${updated}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})