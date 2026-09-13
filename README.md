# USA TV — Stremio addon

A hand-curated collection of **~100 national American live-TV channels**
(news, sports, entertainment, movies, shopping, faith) as a local Stremio/Nuvio
addon. Backed by the free [iptv-org/iptv](https://github.com/iptv-org/iptv)
index with logos/categories from the [iptv-org API](https://iptv-org.github.io/api/).

Built with the official [stremio-addon-sdk](https://github.com/Stremio/stremio-addon-sdk).

## Supported platforms

Pure JavaScript, no native dependencies — runs anywhere Node.js 18+ runs:

| Platform | How to run |
|----------|-----------|
| **Windows** | Install Node LTS → `npm install` → `npm start` |
| **macOS** | Same — works out of the box |
| **Linux** | Same — works out of the box |
| **Chromebook** | Enable Linux (Crostini), then the same steps in the Linux terminal |

Install `http://localhost:59100/manifest.json` in Stremio/Nuvio on any of them.

## Features

- **Curated national list** — only channels people actually watch (no local
  affiliates, no random/offshore feeds, no foreign-language, no kids shows).
- **One simple list, smarter tabs.** A single *All channels* list ordered
  best-known-first (ABC, CBS, NBC, Fox, …) plus lightweight *Sports*, *News*
  and *Everything Else* tabs.
- **Quality at a glance.** `720p` / `1080p` / `4K` tags are appended right on
  the tile names; the best live source is served for each channel.
- **Real logos everywhere.** Every tile shows the channel's real logo (or a
  labeled banner as fallback) — never a generic placeholder.
- **Always live.** Channel list and stream health refresh automatically
  (playlist+metadata every 30 min, dead-stream sweep every 4 h), so you never
  have to restart to get new/updated channels.
- **Premium playlist merge.** Point `EXTRA_M3U` at any M3U URL (e.g. a paid IPTV
  subscription) to add live NFL/NBA/NHL/MLB games, PPV, and premium channels
  under a *Premium* tab.
- **Every country?** Run with `SCOPE=world` to switch to the full ~10,000
  worldwide channels (*IPTV TV* addon id, adds country catalogs).

## Run

```
npm install
npm start                       # curated USA version (default), port 59100
EXTRA_M3U=https://... npm start # also merge your premium playlist
SCOPE=world npm start           # worldwide version
HEALTHCHECK=1 npm start         # probe every channel & permanently prune dead streams
```

Listens on `http://localhost:59100` (override with `PORT`).

## Curating channels (`popular.txt`)

`popular.txt` is a whitelist: a channel is kept if its name, network, or
alt-name contains any listed pattern (one per line, case-insensitive). Add a
line and restart to include a channel. Run with `POPULAR=0` to show every
channel again and discover what's available.

Kids/preschool channels (Nickelodeon, Nick Jr., NickToons, Disney Junior,
Disney XD, PBS Kids, SpongeBob, Peppa Pig, ...) are automatically excluded in
`addon.js`; the main Disney Channel and Adult Swim remain.

## Premium playlist (`EXTRA_M3U`)

For channels free TV doesn't have — especially **live NFL/NBA/NHL/MLB games,
NFL RedZone, regional sports networks, and PPV** — merge in a paid IPTV
subscription playlist:

- **Plain M3U:** use the URL your provider gives you directly.
- **Xtream codes:** turn `server`, `username`, `password` into an M3U URL:

  ```
  http://SERVER:PORT/get.php?username=USER&password=PASS&type=m3u_plus&output=m3u8
  ```

Then start with `EXTRA_M3U=https://that-url npm start`. Matching channels are
de-duplicated against the free list and appear under the *Premium* catalog.

## Install

In Stremio / Nuvio, add the addon manually with:

```
http://localhost:59100/manifest.json
```

## Endpoints

- `GET /manifest.json` — addon manifest (catalogs)
- `GET /catalog/tv/:catalog/all.json` — channel list per catalog
  (`all`, `tab-sports`, `tab-news`, `tab-everything`, `cp-premium`)
- `GET /meta/tv/:id.json` — single channel info
- `GET /stream/tv/:id.json` — best stream for a channel

## Notes on quality

Real bitrate is capped by what the source broadcasts; most free streams are SD
and only a minority reach 720p/1080p. For genuinely high-bitrate 1080p60/4K
feeds (including sports), use the `EXTRA_M3U` premium route. List data refreshes
every 30 minutes with dead-stream sweeps every 4 hours.