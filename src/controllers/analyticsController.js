const axios = require('axios')
const SocialStat = require('../models/SocialStat')
const { AppError } = require('../middleware/errorHandler')

/* ── Cloudflare Web Analytics (GraphQL) ──────────────────────────────────
 * Docs: https://developers.cloudflare.com/analytics/graphql-api/
 * Requires a Cloudflare API Token (Account → "Analytics" → Read) and the
 * Zone ID of the deployed site, set as CLOUDFLARE_API_TOKEN /
 * CLOUDFLARE_ZONE_ID in the backend .env file.
 * ------------------------------------------------------------------------ */
const CF_GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql'

// Simple in-memory cache — Cloudflare's analytics data doesn't need to be
// re-fetched on every dashboard load, and this keeps us well within rate limits.
let cfCache = { key: null, data: null, fetchedAt: 0 }
const CF_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * GET /api/admin/analytics/traffic?days=30
 * Pulls daily request/visit/pageview counts for the site's Cloudflare zone
 * using the rumPageloadEventsAdaptiveGroups / httpRequests1dGroups dataset.
 */
const getTraffic = async (req, res, next) => {
  const token  = process.env.CLOUDFLARE_API_TOKEN
  const zoneId = process.env.CLOUDFLARE_ZONE_ID

  if (!token || !zoneId) {
    return res.json({
      success: true,
      configured: false,
      message: 'Cloudflare analytics not configured — set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID in the backend .env file.',
      data: { daily: [], totals: { requests: 0, pageViews: 0, uniques: 0, bandwidthBytes: 0 } },
    })
  }

  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 90)
  const cacheKey = `${zoneId}:${days}`
  const now = Date.now()
  if (cfCache.key === cacheKey && (now - cfCache.fetchedAt) < CF_CACHE_TTL_MS) {
    return res.json({ success: true, configured: true, cached: true, data: cfCache.data })
  }

  const until = new Date()
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000)
  const fmtDate = d => d.toISOString().slice(0, 10)

  // httpRequests1dGroups: zone-level daily requests, uniques, pageviews & bandwidth.
  const query = `
    query GetZoneAnalytics($zoneTag: string, $since: Date, $until: Date) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequests1dGroups(
            limit: 90
            filter: { date_geq: $since, date_leq: $until }
            orderBy: [date_ASC]
          ) {
            dimensions { date }
            sum {
              requests
              pageViews
              bytes
              threats
            }
            uniq { uniques }
          }
        }
      }
    }
  `

  try {
    const resp = await axios.post(
      CF_GRAPHQL_URL,
      { query, variables: { zoneTag: zoneId, since: fmtDate(since), until: fmtDate(until) } },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 15000 }
    )

    if (resp.data.errors?.length) {
      throw new AppError(resp.data.errors.map(e => e.message).join('; '), 502)
    }

    const groups = resp.data?.data?.viewer?.zones?.[0]?.httpRequests1dGroups || []
    const daily = groups.map(g => ({
      date: g.dimensions.date,
      requests: g.sum.requests,
      pageViews: g.sum.pageViews,
      uniques: g.uniq.uniques,
      bandwidthBytes: g.sum.bytes,
      threats: g.sum.threats,
    }))

    const totals = daily.reduce((acc, d) => ({
      requests: acc.requests + d.requests,
      pageViews: acc.pageViews + d.pageViews,
      uniques: Math.max(acc.uniques, d.uniques), // uniques don't sum meaningfully day-to-day
      bandwidthBytes: acc.bandwidthBytes + d.bandwidthBytes,
    }), { requests: 0, pageViews: 0, uniques: 0, bandwidthBytes: 0 })

    const data = { daily, totals }
    cfCache = { key: cacheKey, data, fetchedAt: now }

    res.json({ success: true, configured: true, cached: false, data })
  } catch (err) {
    if (err instanceof AppError) return next(err)
    const status = err.response?.status
    const cfMsg = err.response?.data?.errors?.map(e => e.message).join('; ')
    next(new AppError(cfMsg || err.message || 'Failed to fetch Cloudflare analytics', status || 502))
  }
}

/* ── Social growth (manual entry, API-ready) ─────────────────────────────
 * Stored in MongoDB so the same chart works today with manual entries and
 * later with data synced automatically from each platform's API.
 * ------------------------------------------------------------------------ */

/**
 * GET /api/admin/analytics/social?platform=linkedin&days=180
 * Returns follower-count history, optionally filtered by platform.
 */
const getSocialStats = async (req, res) => {
  const { platform } = req.query
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 180, 1), 730)
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const filter = { date: { $gte: since } }
  if (platform) filter.platform = platform

  const stats = await SocialStat.find(filter).sort({ date: 1 }).lean()

  // Latest count + net change per platform for stat-card summaries.
  const platforms = ['linkedin', 'facebook', 'instagram']
  const summary = {}
  for (const p of platforms) {
    const rows = stats.filter(s => s.platform === p)
    const latest = rows[rows.length - 1]
    const first = rows[0]
    summary[p] = {
      followers: latest?.followers ?? null,
      change: latest && first ? latest.followers - first.followers : 0,
      lastUpdated: latest?.date ?? null,
    }
  }

  res.json({ success: true, data: { entries: stats, summary } })
}

/**
 * POST /api/admin/analytics/social
 * Body: { platform, followers, date?, note? }
 * Upserts — one entry per platform per day.
 */
const addSocialStat = async (req, res, next) => {
  const { platform, followers, date, note } = req.body

  if (!['linkedin', 'facebook', 'instagram'].includes(platform)) {
    return next(new AppError('platform must be one of linkedin, facebook, instagram', 400))
  }
  if (followers === undefined || followers === null || isNaN(followers) || followers < 0) {
    return next(new AppError('followers must be a non-negative number', 400))
  }

  const day = date ? new Date(date) : new Date()
  day.setHours(0, 0, 0, 0)

  const entry = await SocialStat.findOneAndUpdate(
    { platform, date: day },
    { platform, followers, date: day, note, source: 'manual', addedBy: req.user?._id },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )

  res.status(201).json({ success: true, data: entry })
}

/**
 * DELETE /api/admin/analytics/social/:id
 */
const deleteSocialStat = async (req, res, next) => {
  const deleted = await SocialStat.findByIdAndDelete(req.params.id)
  if (!deleted) return next(new AppError('Entry not found', 404))
  res.json({ success: true, data: deleted })
}

module.exports = { getTraffic, getSocialStats, addSocialStat, deleteSocialStat }