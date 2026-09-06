# Oscarr Plugin — Sonarr Manager

Advanced Sonarr management for [Oscarr](https://github.com/arediss/Oscarr). Browse your Sonarr library, drill into seasons and episodes, run manual searches, view history + queue + blocklist per series — from the Oscarr admin panel.

## Features

- **Library browser** — series list with search, status, network, quality profile filters.
- **Series modal** with season / episode drill-down: availability per episode, manual search, refresh, monitor/unmonitor toggles at series + season level.
- **Releases** with rejection reasons always visible.
- **History + Queue + Blocklist** per series.
- **Analytics** — disk space, episode completion stats, quality distribution.

## Requirements

- **Oscarr core** ≥ 0.6.0 with plugin API `v1`.
- A configured Sonarr service in Oscarr (Settings → Services).
- **Node 20+**.

## Install

From Oscarr admin:
1. **Admin → Plugins → Discover** → find "Sonarr Manager" → **Install**
2. Review the capabilities consent prompt (requests `services:sonarr`)
3. Toggle the plugin on in **Installed**

Or manually:
```bash
cd packages/plugins
git clone https://github.com/arediss/Oscarr-Plugin-Sonarr.git sonarr
```
Then restart Oscarr.

## Manifest declarations

```jsonc
{
  "services": ["sonarr"],
  "capabilities": [],
  "engines": { "oscarr": ">=0.6.0 <1.0.0", "testedAgainst": ["0.6.3"] }
}
```

## Development

```bash
npm install
npm run dev
```

## License

MIT.

## Storage limits

### Dashboard widget

In the admin dashboard, choose **Edit → Add widget → Plugins → Sonarr**.
The widget shows library counters and the two fullest reported storage paths, with links
to the library and analytics. It can be moved and resized like the qBittorrent widget.
Data refreshes every two minutes while the page is visible, or with the refresh button.
It uses the existing `sonarr.view` permission and does not need additional capabilities.

### Per-path limits

Open **Analytics → Storage limits** to record a limit in GiB for each reported path.
Use decimal values when needed; leave a field blank (or enter zero) to remove a limit.
Saved limits for paths temporarily absent from the service remain available in the editor.

Disk bars show **filesystem usage** reported by Sonarr. Linux user/group quota usage is
not included in that data. Declared limits are reference values only: they neither enforce
a server quota nor provide its remaining space. The plugin does not subtract total filesystem
usage from a user's limit, since that usage may include files belonging to other accounts.

## Validation

```bash
npm ci
npm test
npm run build
```
