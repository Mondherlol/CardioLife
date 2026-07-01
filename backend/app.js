require('dotenv').config()
const express = require('express')
const cors    = require('cors')
const path    = require('path')
const connectDB = require('./config/db')

const authRoutes        = require('./routes/auth')
const usersRoutes       = require('./routes/users')
const clientsRoutes     = require('./routes/clients')
const clientTypesRoutes = require('./routes/clientTypes')
const productsRoutes    = require('./routes/products')
const publicProductsRoutes = require('./routes/publicProducts')
const movementsRoutes       = require('./routes/movements')
const installationsRoutes   = require('./routes/installations')
const documentsRoutes       = require('./routes/documents')
const appSettingsRoutes     = require('./routes/appSettings')
const appointmentsRoutes    = require('./routes/appointments')
const controlsRoutes        = require('./routes/controls')
const formationsRoutes      = require('./routes/formations')
const interventionsRoutes   = require('./routes/interventions')
const profileRoutes         = require('./routes/profile')
const dashboardRoutes       = require('./routes/dashboard')

const app = express()

connectDB()

const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5174')
  .split(',')
  .map(o => o.trim())

app.use(cors({
  origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
  exposedHeaders: ['Content-Disposition'],
}))
app.use(express.json())
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

app.use('/api/auth',         authRoutes)
app.use('/api/users',        usersRoutes)
app.use('/api/clients',      clientsRoutes)
app.use('/api/client-types', clientTypesRoutes)
app.use('/api/public/products', publicProductsRoutes)
app.use('/api/products',     productsRoutes)
app.use('/api/movements',     movementsRoutes)
app.use('/api/installations', installationsRoutes)
app.use('/api/documents',     documentsRoutes)
app.use('/api/app-settings',  appSettingsRoutes)
app.use('/api/appointments',  appointmentsRoutes)
app.use('/api/controls',      controlsRoutes)
app.use('/api/formations',     formationsRoutes)
app.use('/api/interventions',  interventionsRoutes)
app.use('/api/profile',        profileRoutes)
app.use('/api/dashboard',      dashboardRoutes)

app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({ message: 'Erreur serveur interne.' })
})

const PORT = process.env.PORT || 5000
app.listen(PORT, () => console.log(`API CardioTrack démarrée sur le port ${PORT}`))
