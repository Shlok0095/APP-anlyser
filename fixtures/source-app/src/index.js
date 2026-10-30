const express = require('express')
const { helper } = require('./routes')

const app = express()
const apiKey = process.env.SAMPLE_KEY

app.get('/health', (_req, res) => {
  res.json({ ok: true, helper: helper() })
})

module.exports = { app, apiKey }
