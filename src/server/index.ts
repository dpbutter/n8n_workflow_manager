import express from 'express'
import cors from 'cors'
import { config } from 'dotenv'

import instancesRouter from './routes/instances.js'
import workflowsRouter from './routes/workflows.js'
import gitRouter from './routes/git.js'

config()

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

// API routes
app.use('/api/instances', instancesRouter)
app.use('/api/workflows', workflowsRouter)
app.use('/api/git', gitRouter)

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
