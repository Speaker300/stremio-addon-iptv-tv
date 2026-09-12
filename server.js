'use strict'

const { serveHTTP } = require('stremio-addon-sdk')
const { init, channelCount } = require('./addon')

const PORT = Number(process.env.PORT || 59100)

init()
  .then(addon => {
    serveHTTP(addon.getInterface(), { port: PORT })
    console.log('[iptv-tv] addon running at http://localhost:' + PORT + '/manifest.json')
    console.log('[iptv-tv] channels loaded:', channelCount())
    console.log('[iptv-tv] add it in Stremio/Nuvio with: http://localhost:' + PORT + '/manifest.json')
  })
  .catch(err => {
    console.error('[iptv-tv] failed to start:', err)
    process.exit(1)
  })