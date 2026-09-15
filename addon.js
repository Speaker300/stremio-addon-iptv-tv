'use strict'

const { addonBuilder } = require('stremio-addon-sdk')
const fs = require('node:fs')
const path = require('node:path')

const PLAYLIST_URL = 'https://iptv-org.github.io/iptv/index.m3u'
const CHANNELS_API = 'https://iptv-org.github.io/api/channels.json'
const DEAD_FILE = path.join(__dirname, 'dead-urls.json')
const REFRESH_MS = 30 * 60 * 1000 // reload playlist + metadata every 30 min
const HEALTH_MS = 4 * 60 * 60 * 1000 // re-probe stream health every 4 h

const MAX_MANIFEST_BYTES = 8000
const POPULAR_FILE = path.join(__dirname, 'popular.txt')
const POPULAR = process.env.POPULAR !== '0'

// secondary free-FAST playlist sources merged into the same pipeline.
// MORE_SOURCES=off disables them; MORE_SOURCES=url1,url2 overrides the defaults.
const MORE_SOURCE_URLS = (() => {
  const env = (process.env.MORE_SOURCES || '').trim()
  if (env && env.toLowerCase() === 'off') return []
  if (env) {
    return env.split(',').map(u => u.trim()).filter(Boolean).map(url => ({ url, country: '', name: 'custom' }))
  }
  return [
    { url: 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8', country: '', name: 'Free-TV' },
    { url: 'https://raw.githubusercontent.com/BuddyChewChew/pluto/main/pluto_us.m3u', country: 'US', name: 'Pluto US' },
    { url: 'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/samsungtvplus_us.m3u', country: 'US', name: 'Samsung TV Plus US' },
    { url: 'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/roku_all.m3u', country: 'US', name: 'Roku' },
    { url: 'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plex_us.m3u', country: 'US', name: 'Plex US' },
    { url: 'https://raw.githubusercontent.com/BuddyChewChew/lg-playlist-generator/main/lg_channels_us.m3u', country: 'US', name: 'LG Channels US' },
  ]
})()

const COUNTRY_CODE = {
  'united states': 'US', 'united states of america': 'US', usa: 'US', america: 'US', 'u.s.a.': 'US',
  canada: 'CA', 'united kingdom': 'GB', uk: 'GB', 'great britain': 'GB', ireland: 'IE',
  australia: 'AU', 'new zealand': 'NZ', mexico: 'MX', brazil: 'BR', france: 'FR',
  germany: 'DE', spain: 'ES', italy: 'IT', india: 'IN', 'south korea': 'KR', japan: 'JP',
}

const popularPatterns = loadPopularPatterns()

function loadPopularPatterns() {
  const patterns = []
  try {
    const text = fs.readFileSync(POPULAR_FILE, 'utf8')
    for (let line of text.split(/\r?\n/)) {
      line = line.trim()
      if (line && !line.startsWith('#')) patterns.push(line.toLowerCase())
    }
  } catch {}
  return patterns
}

function isPopular(ch) {
  if (!popularPatterns.length) return true
  const hay = (ch.name + ' ' + ch.network + ' ' + (ch.alt || []).join(' ')).toLowerCase()
  for (const p of popularPatterns) {
    if (hay.includes(p)) return true
  }
  return false
}

// drop regional/local, state, and foreign-duplicate feeds of national channels;
// merge exact-name duplicate bases and numbering twins (e.g. 'ABC News Live 1..10')
const REGIONAL_DROP = [
  /^(abc|cbs|nbc|fox)\s+\d+\s+/i,
  /^cbs news (?!24\/7\b)/i,
  /^pbs (ket|kids )/i,
  /^arkansas pbs/i,
  /^telemundo corpus/i,
  /^nbc sports bay/i,
  /^wnbc/i,
  /^(coasttv|filamtv|aabc tv|dora tv|kpvm)/i,
  /municipal access/i,
  /^30a\b/i,
  /^iran national revolution/i,
  /^tbn\s+(?:armenia|pacific|україна|ukraina)/i,
  /^(abc|nbc|cbs|fox)\d+/i,
  /^fox local /i,
  /^[kw][a-z]{3}\b/i,
  /\blos angeles\b/i,
  /\baustralia\b/i,
]
const LANG_DUP_DROP = [
  /\blatin america\b/i,
  / en (?:español|espanol)$/i,
  /^amc en espa/i,
  /^csi:.*en espa/i,
  /^nickelodeon (clásico|classico|clássico)/i,
  /^mtv (en espa|flow latino|con mi ex|com o ex|jovens e m[ãa]es|latin america)/i,
  /^avatar:/i,
  /^bob esp/i,
  /^bob l/i,
  /^tortues ninja/i,
  /^las tortugas/i,
  /^south\s+park\b(?:[^\w]*\s*cole| en fran[çc]ais)/i,
  /^sumtv/i,
  /^xite (nuevo|siempre)/i,
  /^newsmax spanish$/i,
  /^golazo network$/i,
]
const KIDS_DROP = [
  /^nick/i, // Nickelodeon*, Nick Jr.*, NickToons
  /^nickelodeon/i,
  /^spongebob/i,
  /^super!/i, // Super! SpongeBob / Super! iCarly
  /^peppa pig/i,
  /^rugrats/i,
  /^hey arnold/i,
  /^icarly/i,
  /^kenan & kel/i,
  /^totally turtles/i,
  /^pbs kids/i,
  /^teen\s*nick/i,
  /^disney junior/i,
  /^disney xd/i,
  /mister rogers/i,
]
// everything Spanish-language (user: 'anything in Spanish')
const SPANISH_DROP = [
  /telemundo/,
  /univision/,
  /galavision/,
  /estrella/,
  /azteca/,
  /deporte/, // ESPN Deportes, Fox Deportes, Pluto TV Deportes
  / en espa(?:ñ|n)ol/,
  /espa(?:ñ|n)ol/,
  /universo/, // NBC Universo
  /novelas/, // TNT Novelas
  /telenovela/,
  /noticias/,
  /f[úu]tbol/,
  /\bmundo\b/,
  /latino/, // Vevo Latino
  /mexic(?:o|a)/,
  /nuestra/,
  /internacional/,
  / al dia/,
  /golazo/,
  /cine selecto/,
]
// channels the user explicitly wants removed (voice list)
const USER_DROP = [
  /^48 hours/,
  /50 cent action/,
  /\bacc network\b/,
  /accuweather/,
  /alien nation/,
  /^all reality/,
  /^all weddings/,
  /amc absolute reality/,
  /top model/, // America's Next Top Model
  /antiques/, // Antiques Roadshow PBS / PBS Antiques Road Trip
  /\banimation\+/, // Animation+
  /bein sports/,
  /bellator/,
  /(^|\s)bet(\s|$)/, // everything from BET
  /better health/,
  /better life/,
  /beyond belief/,
  /beyond the gates/,
  /billiard/, // Billiard TV
  /bloomberg/,
  /^bravo/,
  /\bbyu\b/, // BYUtv
  /^byu/,
  /pluto/, // everything from Pluto
  /^csi/,
  /filmrise/,
  /mtv/, // everything MTV
  /hallmark/,
  /\bhbo\b/,
  /bonanza-billies/,
]

function refineNational(list) {
  const KEEP_NAMES = ['nfl channel', 'paramount movie channel', 'paramount+ picks']
  const drop = (ch) => {
    if (KEEP_NAMES.includes((ch.name || '').toLowerCase())) return false
    const s = (ch.name + ' ' + ch.network + ' ' + (ch.alt || []).join(' ')).toLowerCase()
    for (const re of KIDS_DROP) if (re.test(s)) return true
    for (const re of REGIONAL_DROP) if (re.test(s)) return true
    for (const re of LANG_DUP_DROP) if (re.test(s)) return true
    for (const re of SPANISH_DROP) if (re.test(s)) return true
    for (const re of USER_DROP) if (re.test(s)) return true
    return false
  }
  const isTwin = (name) => {
    const m = name.match(/^(.*?)\s+\d{1,2}$/i)
    return m ? m[1] : ''
  }
  const isTwinName = (name) => /\s+\d{1,2}$/i.test(name)
  const kept = list.filter(ch => !drop(ch))

  const merged = []
  const byName = new Map()
  for (const ch of kept) {
    if (isTwinName(ch.name)) continue // numbered twin -> folded in pass 2
    const key = ch.name.toLowerCase()
    const existing = byName.get(key)
    if (existing) {
      existing.variants.push(...ch.variants)
      existing.bestScore = Math.max(existing.bestScore, ch.bestScore)
    } else {
      const clone = Object.assign({}, ch, { variants: ch.variants.slice() })
      byName.set(key, clone)
      merged.push(clone)
    }
  }
  // pass 2: fold 'X 1'..'X N' variants into base channel 'X'; keep unresolved twins
  let folded = 0
  for (const ch of kept) {
    const base = isTwin(ch.name)
    if (!base) continue
    const b = byName.get(base.toLowerCase())
    if (b) {
      b.variants.push(...ch.variants)
      folded++
      continue
    }
    // no unnumbered base exists (e.g. 'Fox Sports 1') -> keep as its own channel
    const key = ch.name.toLowerCase()
    const clone = Object.assign({}, ch, { variants: ch.variants.slice() })
    byName.set(key, clone)
    merged.push(clone)
  }
  if (folded) console.log('[iptv-tv] refine folded twins:', folded)
  // merge near-identical names (case/punctuation/leading-'the'/quality-suffix variants across sources)
  const byCanon = new Map()
  let canonMerged = 0
  for (const ch of merged) {
    const key = canonicalKey(ch.name)
    const existing = byCanon.get(key)
    if (existing) {
      existing.variants.push(...ch.variants)
      existing.bestScore = Math.max(existing.bestScore, ch.bestScore)
      canonMerged++
    } else {
      byCanon.set(key, ch)
    }
  }
  const canonicalList = merged.filter(ch => byCanon.get(canonicalKey(ch.name)) === ch)
  if (canonMerged) console.log('[iptv-tv] refine merged duplicates:', canonMerged)
  for (const ch of canonicalList) {
    ch.variants.sort((a, b) => b.quality.score - a.quality.score)
    ch.bestScore = Math.max(...ch.variants.map(v => v.quality.score))
  }
  return canonicalList
}

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

// ordering: most-watched national channels first, then alphabetical
const RANK_GROUPS = [
  ['abc', 'cbs', 'nbc', 'fox', 'pbs', 'the cw', 'cw'],
  ['espn', 'fox sports', 'nbc sports', 'cbs sports', 'nfl network', 'nfl channel', 'nba tv', 'nhl network', 'mlb', 'big ten network', 'sec network', 'tennis channel', 'yes network'],
  ['fox news', 'cnbc', 'newsmax', 'newsnation', 'cheddar', 'weather', 'weathernation', 'court tv', 'live now', 'story television', 'dateline'],
  ['amc', 'usa network', 'syfy', 'paramount', 'comedy central', 'national geographic', 'nat geo', 'disney', 'freeform', 'lifetime', 'a&e', 'oxygen', 'showtime', 'starz', 'tnt', 'tbs'],
]
function channelText(ch) {
  return (ch.name + ' ' + ch.network + ' ' + (ch.alt || []).join(' ')).toLowerCase()
}
function rankOf(ch) {
  const s = channelText(ch)
  for (let i = 0; i < RANK_GROUPS.length; i++) {
    if (RANK_GROUPS[i].some(p => s.includes(p))) return i
  }
  return RANK_GROUPS.length
}
function sortByPriority(list) {
  list.sort((a, b) => (rankOf(a) - rankOf(b)) || a.name.localeCompare(b.name))
}
const SPORTS_TAB = /espn|sports|golazo|nfl|nba|nhl|mlb\b|tennis|racing|racer|motor ?trend|powernation|outdoor|poker|billiard/i
const NEWS_TAB = /\bnews\b|cnbc|bloomberg|weather|weathernation|cheddar|live now|story television|court tv|dateline/i
function tabOf(ch) {
  const s = channelText(ch)
  if (SPORTS_TAB.test(s)) return 'tab-sports'
  if (NEWS_TAB.test(s)) return 'tab-news'
  return 'tab-everything'
}

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
  n = n.replace(/\s+\d{3,4}p\s*$/gi, '')
  n = n.replace(/\s*\[[^\]]*\]\s*$/g, '')
  return n.replace(/\s{2,}/g, ' ').trim()
}

// collision key for merging near-identical names across sources
const canonicalKey = (name) => (name || '').toLowerCase()
  .replace(/^the\s+/, '')
  .replace(/[^a-z0-9]/g, '')

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
        tvgName: attrs['tvg-name'] || '',
        logo: attrs['tvg-logo'] || '',
        group: attrs['group-title'] || '',
        countryAttr: attrs['tvg-country'] || '',
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

function channelCountry(s, info, fallbackCountry) {
  if (info && info.country) return info.country.toUpperCase()
  const fromId = countryFromId(s.tvgId)
  if (fromId) return fromId
  if (s.countryAttr) {
    const c = s.countryAttr.trim().toLowerCase()
    if (COUNTRY_CODE[c]) return COUNTRY_CODE[c]
    if (/^[a-z]{2}$/.test(c)) return c.toUpperCase()
  }
  const g = (s.group || '').trim().toLowerCase()
  if (COUNTRY_CODE[g]) return COUNTRY_CODE[g]
  return fallbackCountry || ''
}

function absorbStream(baseMap, seenUrl, s, channelInfo, fallbackCountry) {
  if (!s.url || !/^https?:/i.test(s.url)) return 0
  if (seenUrl.has(s.url)) return 0
  const tvgBase = String(s.tvgId || '').split('@')[0]
  const info = tvgBase ? channelInfo.get(tvgBase) : null
  if (info && info.is_nsfw) return 0

  const key = tvgBase || cleanName(s.name).toLowerCase() || 'channel'
  const apiCats = (info && Array.isArray(info.categories))
    ? info.categories.filter(c => GROUP_MAP[c])
    : []

  const qual = parseQuality(s.name, s.tvgId)
  let base = baseMap.get(key)
  if (!base) {
    base = {
      name: cleanName(s.name) || tvgBase,
      country: channelCountry(s, info, fallbackCountry),
      logo: s.logo || (info && info.logo) || '',
      cat: '',
      network: (info && info.network) || '',
      alt: (info && info.alt_names) || [],
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
  return 1
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
    absorbStream(baseMap, seenUrl, s, channelInfo, '')
  }

  // merge curated free-FAST playlists into the same base pool
  if (MORE_SOURCE_URLS.length) {
    for (const src of MORE_SOURCE_URLS) {
      try {
        const res = await fetch(src.url)
        if (!res.ok) {
          console.warn('[iptv-tv] source fetch failed:', src.name, res.status)
          continue
        }
        const text = await res.text()
        let added = 0
        for (const s of parseM3U(text)) {
          added += absorbStream(baseMap, seenUrl, s, channelInfo, src.country)
        }
        console.log('[iptv-tv] source ' + src.name + ': ' + added + ' stream variants')
      } catch (err) {
        console.warn('[iptv-tv] source error:', src.name, err.message)
      }
    }
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

  // keep only well-known national channels absent POPULAR=0
  if (POPULAR && popularPatterns.length) {
    const before = channels.length
    const kept = channels.filter(isPopular)
    const removed = channels.filter(ch => !isPopular(ch))
    if (removed.length) {
      console.log('[iptv-tv] popular only: ' + before + ' -> ' + kept.length +
        ' channels (dropped e.g. ' + removed.slice(0, 8).map(ch => ch.name).join(' | ') + ')')
    }
    channels.length = 0
    channels.push(...kept)
    const refined = refineNational(channels)
    if (refined.length !== channels.length) {
      console.log('[iptv-tv] national refine: ' + channels.length + ' -> ' + refined.length + ' channels')
    }
    channels.length = 0
    channels.push(...refined)
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
let byTab = new Map()
let premiumIndices = []

function buildCatalogs() {
  const tabs = new Map()
  const premium = []
  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i]
    const t = tabOf(ch)
    if (!tabs.has(t)) tabs.set(t, [])
    tabs.get(t).push(i)
    if (ch.premium) premium.push(i)
  }
  byTab = tabs
  premiumIndices = premium

  const catalogs = [
    { id: 'all', type: 'tv', name: TITLE + ' — All channels' },
  ]
  if (premium.length) catalogs.push({ id: 'cp-premium', type: 'tv', name: 'Premium (your playlist)' })
  if ((tabs.get('tab-sports') || []).length) catalogs.push({ id: 'tab-sports', type: 'tv', name: 'Sports' })
  if ((tabs.get('tab-news') || []).length) catalogs.push({ id: 'tab-news', type: 'tv', name: 'News' })
  if ((tabs.get('tab-everything') || []).length) catalogs.push({ id: 'tab-everything', type: 'tv', name: 'Everything Else' })
  return { catalogs }
}

function buildManifest(catalogs) {
  const isUs = SCOPED_COUNTRY === 'US'
  return {
    id: isUs ? 'community.usatv' : 'community.iptvtv',
    version: '1.8.0',
    name: TITLE,
    description: isUs
      ? 'American live TV — news, sports, entertainment. Powered by iptv-org.'
      : 'Worldwide live TV with multi-quality streams. Powered by iptv-org.',
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
  const logo = (pick && pick.logo) || ch.logo
  return logo || 'https://placehold.co/600x400?text=' + encodeURIComponent(ch.name)
}

function toMeta(i) {
  const ch = channels[i]
  const flag = ch.bestScore >= 2160 ? ' 4K' : ch.bestScore >= 1080 ? ' 1080p' : ch.bestScore >= 720 ? ' 720p' : ''
  return {
    id: 'gp.ch.' + i,
    type: 'tv',
    name: ch.name + flag,
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
    const skip = Number(args.extra && args.extra.skip) || 0
    let indices = []
    if (args.id === 'all') indices = channels.map((_, i) => i)
    else if (args.id === 'cp-premium') indices = premiumIndices
    else if (args.id.startsWith('tab-')) indices = byTab.get(args.id) || []
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
    const best = ch.variants[0]
    if (!best) return Promise.resolve({ streams: [] })
    const label = best.quality.label
    return Promise.resolve({
      streams: [{
        url: best.url,
        title: ch.name,
        name: label || 'Live TV',
      }],
    })
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
  sortByPriority(channels)
  console.log(`[health] dead urls: ${dead.size} (total ${deadUrls.size}), channels ${beforeCh} -> ${channels.length}`)
}

let manifestCatalogs = []

async function init() {
  channels = await loadChannels()
  sortByPriority(channels)
  if (process.env.HEALTHCHECK === '1') {
    await sweepHealth()
    sortByPriority(channels)
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
      sortByPriority(channels)
      buildCatalogs()
      console.log('[iptv-tv] playlist refreshed:', channels.length, 'channels')
    } catch (err) {
      console.error('[iptv-tv] refresh failed:', err.message)
    }
  }, REFRESH_MS)
  setInterval(async () => {
    try {
      await sweepHealth()
      sortByPriority(channels)
      buildCatalogs()
    } catch (err) {
      console.error('[iptv-tv] health sweep failed:', err.message)
    }
  }, HEALTH_MS)
  return builder
}

loadDeadUrls()

module.exports = { init, sweepHealth, channelCount: () => channels.length }