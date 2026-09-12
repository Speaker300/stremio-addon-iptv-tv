# IPTV TV — Stremio addon

Worldwide live TV (news, sports, entertainment, kids, music, movies, and more)
as a local Stremio addon. Backed by the free
[iptv-org/iptv](https://github.com/iptv-org/iptv) index (~11,000 streams),
with official channel logos/categories from the
[iptv-org API](https://iptv-org.github.io/api/).

Built with the official [stremio-addon-sdk](https://github.com/Stremio/stremio-addon-sdk).

## Features

- **~10,000 channels worldwide**, browsable by category (`cat-*`), country
  (`cc-*`), and quality filter (`q-hd` = 720p and up).
- **Multiple quality variants per channel.** Every alternative source for a
  channel is returned as its own stream, sorted best-first (4K > 1080p > 720p >
  SD), so the player can pick the highest available bitrate.
- **Optional premium playlist.** Point `EXTRA_M3U` at any M3U URL to merge your
  own high-bitrate/paid subscription channels into the addon (shown under the
  *Premium* catalog).

## Run

```
npm install
npm start          # optionally: EXTRA_M3U=https://example.com/playlist.m3u npm start
```

Listens on `http://localhost:59100` (override with `PORT`).

## Install

In Stremio / Nuvio, add the addon manually with:

```
http://localhost:59100/manifest.json
```

## Endpoints

- `GET /manifest.json` — addon manifest (catalogs)
- `GET /catalog/tv/:catalog/all.json` — channel list per catalog
  (`all`, `q-hd`, `cp-premium`, `cat-<category>`, `cc-<country>`)
- `GET /meta/tv/:id.json` — single channel info (includes source/quality count)
- `GET /stream/tv/:id.json` — all stream variants for a channel, best-first

## Notes on quality

Real bitrate is capped by what the source broadcasts. In iptv-org's free index
roughly: ~10 channels at 4K, ~200 at 1080p, ~800 at 720p; the rest are SD. For
genuinely higher bitrates, use a premium IPTV subscription and feed its M3U
through `EXTRA_M3U`. The channel list + metadata refresh every 6 hours.