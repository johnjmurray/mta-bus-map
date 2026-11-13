# MTA Bus Map

A static interactive map of active MTA bus routes, stops, and live bus positions. It can be hosted on GitHub Pages and does not require Node.js or a server to run.

## Live bus access and privacy

Live bus tracking is optional. A visitor enters their own MTA Bus Time API key in the page to enable it. The key stays in page memory for that visit and is cleared on reload or with **Clear key**; it is not stored in local storage, cookies, or this repository. Requests go directly from the visitor's browser to MTA, so the key is visible to that visitor. Do not enter a key unless you are authorized to use it. The Codespaces secret is not available to GitHub Pages.

## Deploy to GitHub Pages

In repository **Settings → Pages**, choose the publishing source/branch and folder containing `index.html`, then save. The site is static; no build step or npm installation is required.

## Data and behavior

- Active route shapes and stop information load from NY Open Data Socrata datasets when the page starts and when **Refresh data** is clicked.
- Live bus positions come directly from the MTA Bus Time SIRI vehicle-monitoring API after a visitor provides a key. The feed refreshes every five minutes; selecting a route filters its route line and live vehicles, while all bus stops remain visible.
- Bus stop tooltips list the routes serving each stop, combining route records for stops served by multiple routes.
- Search and select routes to focus the map. Route, stop, and bus layers can be toggled independently.
- Leaflet displays a grayscale CARTO basemap with a dark, squared-off control theme.

An internet connection is required for the map tiles, Leaflet CDN, public route/stop datasets, and (if enabled) MTA live feed. Browser access to the MTA API depends on its CORS policy; if the API does not permit cross-origin requests from the Pages origin, direct browser access will fail and a separate server-side proxy will be needed.
