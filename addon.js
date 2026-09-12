'use strict'

const { addonBuilder } = require('stremio-addon-sdk')
const fs = require('node:fs')
const path = require('node:path')

const PLAYLIST_URL = 'https://iptv-org.github.io/iptv/index.m3u'
const CHANNELS_API = 'https://iptv-org.github.io/api/channels.json'
const DEAD_FILE = path.join(__dirname, 'dead-urls.json')
const REFRESH_MS = 6 * 60 * 60 * 1000

const PLACEHOLDER = 'https://placehold.co/600x400?text=TV'
const MAX_MANIFEST_BYTES = 8000

const deadUrls = new Set()

function loadDeadUrls() {
  try {
    const arr = JSON.parse(fs.readFileSync(DEAD_FILE, 'utf8'))
    if (Array.isArray(arr)) {
      deadUrls.clear()
      for (const u of arr) deadUrls.add(u)
    }
  } catch {}
}

function saveDeadUrls() {
  fs.writeFileSync(DEAD_FILE, JSON.stringify([...deadUrls]))
}

const SCOPE = (process.env.SCOPE || 'us').toLowerCase().trim()
const SCOPED_COUNTRY = SCOPE && SCOPE !== 'world' ? SCOPE.toUpperCase() : ''
const TITLE = SCOPED_COUNTRY === 'US' ? 'USA TV' : 'IPTV TV'

const GROUP_MAP = {
  general: 'general', news: 'news', sports: 'sports', movies: 'movies',
  cinema: 'movies', series: 'series', drama: 'series', music: 'music',
  kids: 'kids', documentary: 'documentary', culture: 'culture',
  religious: 'religious', education: 'education', science: 'science',
  lifestyle: 'lifestyle', business: 'business', entertainment: 'entertainment',
  comedy: 'comedy', cooking: 'cooking', food: 'cooking', outdoor: 'outdoors',
  talk: 'talk', technology: 'technology', tech: 'technology', travel: 'travel',
  weather: 'weather', auto: 'auto', shopping: 'shopping', shop: 'shopping',
  gaming: 'gaming', games: 'gaming', history: 'history', health: 'health',
  anime: 'anime', family: 'family', fashion: 'fashion', hobby: 'hobby',
  home: 'home', lgbt: 'lgbtq', relax: 'general', special: 'special',
  unknown: 'general', undefined: 'general',
}

const KEYWORD_RULES = [
  [/news/i, 'news'], [/sports?\b/i, 'sports'], [/movie/i, 'movies'],
  [/\.cinema/i, 'movies'], [/series/i, 'series'], [/music/i, 'music'],
  [/cartoon/i, 'kids'], [/kids\b/i, 'kids'], [/document/i, 'documentary'],
  [/docu/i, 'documentary'], [/history/i, 'history'], [/science/i, 'science'],
  [/business/i, 'business'], [/finance/i, 'business'], [/relig/i, 'religious'],
  [/church/i, 'religious'], [/educat/i, 'education'], [/lifestyle/i, 'lifestyle'],
  [/cook/i, 'cooking'], [/food/i, 'cooking'], [/comedy/i, 'comedy'],
  [/outdoor/i, 'outdoors'], [/weather/i, 'weather'], [/talk/i, 'talk'],
  [/tech/i, 'technology'], [/travel/i, 'travel'], [/anime/i, 'anime'],
  [/gaming/i, 'gaming'], [/entertainment/i, 'entertainment'],
  [/shop/i, 'shopping'], [/auto/i, 'auto'], [/health/i, 'health'],
]

// tvg-id quality suffixes and name markers -> quality score + label
function parseQuality(name, tvgId) {
  const tagged = tvgId.match(/@(SD|HD|FHD|UHD|4K|HEVC|)\b/i)
  if (tagged) {
    const q = tagged[1].toLowerCase()
    if (q === 'uhd' || q === '4k') return { score: 2160, label: '4K' }
    if (q === 'fhd') return { score: 1080, label: '1080p' }
    if (q === 'hd') return { score: 720, label: '720p' }
    if (q === 'sd') return { score: 480, label: '480p' }
  }
  const m = name.match(/\((\d{3,4})\s*p\)/i)
  if (m) {
    const v = Number(m[1])
    return { score: v, label: v + 'p' }
  }
  if (/(4k|uhd|2160)/i.test(name)) return { score: 2160, label: '4K' }
  if (/\bfhd\b|\(?1080/i.test(name)) return { score: 1080, label: '1080p' }
  if (/\bhd\b|\(?720/i.test(name)) return { score: 720, label: '720p' }
  if (/\bsd\b|\(?576/i.test(name)) return { score: 576, label: '576p' }
  if (/\bsd\b|\(?480/i.test(name)) return { score: 480, label: '480p' }
  return { score: 0, label: '' }
}

function cleanName(name) {
  let n = name.replace(/\(.*\d+\s*p\)/gi, '')
  n = n.replace(/\((?:fhd|uhd|hd|sd|4k|hevc)\)/gi, '')
  n = n.replace(/\s+(?:fhd|uhd|4k|hd|hevc)\s*$/gi, '')
  n = n.replace(/\s*\[[^\]]*\]\s*$/g, '')
  return n.replace(/\s{2,}/g, ' ').trim()
}

function parseM3U(text) {
  const streams = []
  const lines = text.split(/\r?\n/)
  let pending = null
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('#EXTINF')) {
      const body = line.slice('#EXTINF:'.length)
      const commaIdx = body.lastIndexOf(',')
      const attrsText = commaIdx >= 0 ? body.slice(0, commaIdx) : body
      const name = commaIdx >= 0 ? body.slice(commaIdx + 1).trim() : ''
      const attrs = {}
      const re = /([\w.-]+)="([^"]*)"/g
      let match
      while ((match = re.exec(attrsText)) !== null) {
        attrs[match[1].toLowerCase()] = match[2]
      }
      pending = {
        name,
        tvgId: String(attrs['tvg-id'] || ''),
        logo: attrs['tvg-logo'] || '',
        group: attrs['group-title'] || '',
        url: '',
      }
    } else if (pending && line && !line.startsWith('#')) {
      pending.url = line
      streams.push(pending)
      pending = null
    }
  }
  return streams
}

function groupToCat(group) {
  const g = group.trim().toLowerCase()
  if (GROUP_MAP[g]) return GROUP_MAP[g]
  for (const [re, cat] of KEYWORD_RULES) {
    if (re.test(group)) return cat
  }
  return 'general'
}

function countryFromId(tvgId) {
  const m = tvgId && tvgId.match(/\.([a-z]{2})(?:\.|@|$)/i)
  return m ? m[1].toUpperCase() : ''
}

async function loadChannels() {
  const [playlistRes, channelsRes] = await Promise.all([
    fetch(PLAYLIST_URL),
    fetch(CHANNELS_API),
  ])
  if (!playlistRes.ok) throw new Error('playlist fetch failed: ' + playlistRes.status)
  if (!channelsRes.ok) throw new Error('channels api fetch failed: ' + channelsRes.status)

  const playlistText = await playlistRes.text()
  const apiChannels = await channelsRes.json()

  const channelInfo = new Map()
  for (const c of apiChannels) {
    if (c.id) channelInfo.set(c.id, c)
  }

  const rawStreams = parseM3U(playlistText)
    .filter(s => s.url && (s.url.startsWith('http://') || s.url.startsWith('https://')))

  // group every variant of a channel into one base channel
  const baseMap = new Map()
  const seenUrl = new Set()

  for (const s of rawStreams) {
    if (seenUrl.has(s.url)) continue
    const tvgBase = s.tvgId.split('@')[0]
    const info = tvgBase ? channelInfo.get(tvgBase) : null
    if (info && info.is_nsfw) continue

    const key = tvgBase || cleanName(s.name).toLowerCase() || 'channel'
    const apiCats = (info && Array.isArray(info.categories))
      ? info.categories.filter(c => GROUP_MAP[c])
      : []

    const qual = parseQuality(s.name, s.tvgId)
    let base = baseMap.get(key)
    if (!base) {
      base = {
        name: cleanName(s.name) || tvgBase,
        country: (info && info.country) ? info.country.toUpperCase() : countryFromId(s.tvgId),
        logo: s.logo || (info && info.logo) || '',
        cat: '',
        variants: [],
        bestScore: -1,
      }
      baseMap.set(key, base)
    }

    if (!base.cat) {
      base.cat = (apiCats.length && GROUP_MAP[apiCats[0]]) || groupToCat(s.group) || 'general'
    }

    base.logo = base.logo || s.logo
    base.variants.push({
      url: s.url,
      name: s.name,
      logo: s.logo || '',
      quality: qual,
    })
    if (qual.score >= base.bestScore) {
      base.bestScore = qual.score
      if (s.logo) base.logo = s.logo
    }
    seenUrl.add(s.url)
  }

  const channels = []
  for (const base of baseMap.values()) {
    if (!base.cat) base.cat = 'general'
    base.variants = base.variants.filter(v => !deadUrls.has(v.url))
    if (!base.variants.length) continue
    base.bestScore = Math.max(...base.variants.map(v => v.quality.score))
    base.variants.sort((a, b) => b.quality.score - a.quality.score)
    channels.push(base)
  }
  channels.sort((a, b) => a.name.localeCompare(b.name))

  // optional country scope (e.g. SCOPE=us for a USA-only version)
  if (SCOPED_COUNTRY) {
    const before = channels.length
    const filtered = channels.filter(ch => ch.country === SCOPED_COUNTRY)
    channels.length = 0
    channels.push(...filtered)
    console.log(`[iptv-tv] scope ${SCOPED_COUNTRY}: ${before} -> ${channels.length} channels`)
  }

  // optional user-supplied premium playlist merged into the same catalog
  const extraUrl = process.env.EXTRA_M3U
  if (extraUrl) {
    try {
      const extraRes = await fetch(extraUrl)
      if (extraRes.ok) {
        const extraText = await extraRes.text()
        const existing = new Set(channels.flatMap(c => c.variants.map(v => v.url)))
        for (const s of parseM3U(extraText)) {
          if (!s.url || !/^https?:/i.test(s.url)) continue
          if (existing.has(s.url)) continue
          const qual = parseQuality(s.name, s.tvgId)
          channels.push({
            name: cleanName(s.name) || s.name,
            country: countryFromId(s.tvgId),
            logo: s.logo || '',
            cat: groupToCat(s.group),
            bestScore: qual.score,
            premium: true,
            variants: [{ url: s.url, name: s.name, logo: s.logo || '', quality: qual }],
          })
          existing.add(s.url)
        }
        channels.sort((a, b) => a.name.localeCompare(b.name))
        console.log('[iptv-tv] merged premium playlist chunks:', channels.length)
      } else {
        console.warn('[iptv-tv] EXTRA_M3U fetch failed:', extraRes.status)
      }
    } catch (err) {
      console.warn('[iptv-tv] EXTRA_M3U error:', err.message)
    }
  }
  return channels
}

let channels = []
let byCatalog = new Map()
let byCountry = new Map()
let hdIndices = []
let premiumIndices = []

function buildCatalogs() {
  const byCat = new Map()
  const byCountryLocal = new Map()
  const hd = []
  const premium = []
  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i]
    if (!byCat.has(ch.cat)) byCat.set(ch.cat, [])
    byCat.get(ch.cat).push(i)
    if (ch.premium) premium.push(i)
    if (ch.bestScore >= 720) hd.push(i)
    if (ch.country) {
      if (!byCountryLocal.has(ch.country)) byCountryLocal.set(ch.country, [])
      byCountryLocal.get(ch.country).push(i)
    }
  }
  byCatalog = byCat
  byCountry = byCountryLocal
  hdIndices = hd
  premiumIndices = premium

  const catalogs = [
    { id: 'all', type: 'tv', name: TITLE + ' — All channels' },
  ]
  if (hd.length >= 20) catalogs.push({ id: 'q-hd', type: 'tv', name: 'Quality: HD+ (720p/1080p/4K)' })
  if (premium.length) catalogs.push({ id: 'cp-premium', type: 'tv', name: 'Premium (your playlist)' })
  for (const [cat, idx] of [...byCat.entries()].sort(([, a], [, b]) => b.length - a.length)) {
    if (idx.length < 10) continue
    catalogs.push({ id: 'cat-' + cat, type: 'tv', name: 'Category: ' + cap(cat) })
  }
  if (!SCOPED_COUNTRY) {
    const countryList = [...byCountryLocal.entries()]
      .filter(([, idx]) => idx.length >= 20)
      .sort(([, a], [, b]) => b.length - a.length)
    for (const [cc] of countryList) {
      catalogs.push({ id: 'cc-' + cc, type: 'tv', name: 'Country: ' + cc })
    }
  }
  return { catalogs }
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function buildManifest(catalogs) {
  const isUs = SCOPED_COUNTRY === 'US'
  return {
    id: isUs ? 'community.usatv' : 'community.iptvtv',
    version: '1.5.0',
    name: TITLE,
    description: isUs
      ? 'American live TV — news, sports, entertainment, kids, music. Powered by iptv-org.'
      : 'Worldwide live TV — news, sports, movies, kids, music, with multi-quality streams. Powered by iptv-org.',
    catalogs,
    resources: ['catalog', 'meta', 'stream'],
    types: ['tv'],
  }
}

function trimCatalogsForManifest(allCatalogs) {
  const base = JSON.parse(JSON.stringify(buildManifest([])))
  const baseLen = JSON.stringify(base).length
  const budget = MAX_MANIFEST_BYTES - baseLen - 2
  const keep = []
  let used = 0
  for (const c of allCatalogs) {
    const entry = JSON.stringify(c)
    if (used + entry.length + 1 > budget) break
    keep.push(c)
    used += entry.length + 1
  }
  return keep
}

function bestLogo(ch) {
  const pick = ch.variants.find(v => v.logo) || ch.variants[0]
  return (pick && pick.logo) || ch.logo || PLACEHOLDER
}

function toMeta(i) {
  const ch = channels[i]
  return {
    id: 'gp.ch.' + i,
    type: 'tv',
    name: ch.name,
    poster: bestLogo(ch),
    posterShape: 'landscape',
    background: bestLogo(ch),
  }
}

function qualityLabel(ch) {
  const best = ch.variants[0]
  return best ? best.quality.label : ''
}

function run(catalogs) {
  const builder = new addonBuilder(buildManifest(catalogs))

  builder.defineCatalogHandler(args => {
    const skip = args.extra && args.extra.skip ? args.extra.skip : 0
    let indices = []
    if (args.id === 'all') indices = channels.map((_, i) => i)
    else if (args.id === 'q-hd') indices = hdIndices
    else if (args.id === 'cp-premium') indices = premiumIndices
    else if (args.id.startsWith('cat-')) indices = byCatalog.get(args.id.slice(4)) || []
    else if (args.id.startsWith('cc-')) indices = byCountry.get(args.id.slice(3)) || []
    const metas = indices.slice(skip, skip + 100).map(toMeta)
    return Promise.resolve({ metas })
  })

  builder.defineMetaHandler(args => {
    const m = args.id.match(/^gp\.ch\.(\d+)$/)
    if (m && channels[Number(m[1])]) {
      const ch = channels[Number(m[1])]
      const meta = toMeta(Number(m[1]))
      meta.description = ch.variants.length > 1
        ? ch.variants.length + ' sources available, up to ' + qualityLabel(ch) + '.'
        : 'Single source' + (qualityLabel(ch) ? ' at ' + qualityLabel(ch) : '') + '.'
      meta.logo = bestLogo(ch)
      return Promise.resolve({ meta })
    }
    return Promise.resolve({ meta: { id: args.id, type: 'tv', name: args.id } })
  })

  builder.defineStreamHandler(args => {
    const m = args.id.match(/^gp\.ch\.(\d+)$/)
    if (!m || !channels[Number(m[1])]) return Promise.resolve({ streams: [] })
    const ch = channels[Number(m[1])]
    const streams = ch.variants.map(v => {
      const label = v.quality.label
      return {
        url: v.url,
        title: (label ? label + ' · ' : '') + ch.name,
        name: label || 'Live TV',
      }
    })
    return Promise.resolve({ streams })
  })

  return builder
}

async function sweepHealth() {
  const urls = [...new Set(channels.flatMap(c => c.variants.map(v => v.url)))]
  const dead = new Set()
  const conc = 40
  let done = 0
  for (let i = 0; i < urls.length; i += conc) {
    const batch = urls.slice(i, i + conc)
    const results = await Promise.all(batch.map(async u => {
      try {
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), 8000)
        const res = await fetch(u, {
          method: 'GET',
          headers: {
            Range: 'bytes=0-65535',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0 Safari/537.36',
          },
          redirect: 'follow',
          signal: ctrl.signal,
        })
        clearTimeout(t)
        const alive = (res.status >= 200 && res.status < 300) || res.status === 416
        return alive ? null : u
      } catch {
        return u
      }
    }))
    for (const d of results) if (d) dead.add(d)
    done += batch.length
    process.stdout.write(`\r[health] ${done}/${urls.length}`)
  }
  process.stdout.write('\n')
  for (const d of dead) deadUrls.add(d)
  saveDeadUrls()
  for (const ch of channels) {
    ch.variants = ch.variants.filter(v => !dead.has(v.url))
  }
  const beforeCh = channels.length
  channels = channels.filter(ch => ch.variants.length > 0)
  console.log(`[health] dead urls: ${dead.size} (total ${deadUrls.size}), channels ${beforeCh} -> ${channels.length}`)
}

let manifestCatalogs = []

async function init() {
  channels = await loadChannels()
  if (process.env.HEALTHCHECK === '1') {
    await sweepHealth()
  }
  const { catalogs } = buildCatalogs()
  let finalCatalogs = catalogs
  const fullLen = JSON.stringify(buildManifest(catalogs)).length
  if (fullLen > MAX_MANIFEST_BYTES) {
    finalCatalogs = trimCatalogsForManifest(catalogs)
    console.log('[iptv-tv] trimmed catalogs:', finalCatalogs.length, 'of', catalogs.length)
  }
  manifestCatalogs = finalCatalogs
  const builder = run(finalCatalogs)
  setInterval(async () => {
    try {
      channels = await loadChannels()
      buildCatalogs()
      console.log('[iptv-tv] playlist refreshed:', channels.length, 'channels')
    } catch (err) {
      console.error('[iptv-tv] refresh failed:', err.message)
    }
  }, REFRESH_MS)
  return builder
}

loadDeadUrls()

module.exports = { init, sweepHealth, channelCount: () => channels.length }