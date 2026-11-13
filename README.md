# MTA Bus Map

A small interactive web app for exploring active MTA bus routes, stops, and live bus positions on a map.

## Run locally

Requires Node.js 18 or newer. No npm dependencies are needed.

```sh
# Configure the MTA Bus Time key for the live vehicle feed.
MTA_API_KEY=your_mta_key npm start
```

Then open [http://localhost:3000](http://localhost:3000). On PowerShell, set the key first with `$env:MTA_API_KEY="your_mta_key"` and run `npm start`.

The key is read by the local server and is not embedded in browser code. The key supplied in a chat request is intentionally not committed to this repository; configure your own key in the server environment. Routes and stops are fetched directly from the public NY Open Data Socrata datasets. Live bus locations refresh every 15 seconds.

## Map controls

- Search or select a route to focus the map and filter its stops and vehicles.
- Toggle route, stop, and live vehicle layers independently.
- Select a route line or marker to view route and stop details.
- Use **Refresh data** to reload routes and stops. The live feed continues to refresh automatically.

The map uses Leaflet and OpenStreetMap tiles via public CDNs/services, so an internet connection is required. If the live feed is unavailable, the route and stop layers remain usable and the live-feed error is shown in the status panel.
