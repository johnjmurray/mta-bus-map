# MTA Bus Map

A static interactive map of active MTA bus routes, stops, and live bus positions. It can be hosted on GitHub Pages and does not require Node.js or a server to run.

## Live bus access and privacy

Live bus tracking is optional. Each visitor enters their own MTA Bus Time API key in the page to enable it. The key is held only in page memory for that visit, is cleared on reload or when **Clear key** is selected, and is not stored in local storage, cookies, or this repository. The page makes the authenticated request directly from the visitor's browser to the MTA Bus Time API. Because browser requests expose the key to that visitor and the API provider, visitors should enter only a key they are authorized to use and should not use this design for a shared service-owned secret.

This static setup does not use or access the repository's Codespaces secret. A Codespaces secret is only available to Codespaces; it cannot safely be read by a GitHub Pages site.

## Deploy to GitHub Pages

In the repository, open **Settings → Pages**, choose the publishing source/branch and folder containing `index.html`, then save. GitHub Pages publishes the static HTML, CSS, and JavaScript. No build step or npm installation is required.

## Data and behavior

- Active route shapes and stop information are loaded from the NY Open Data Socrata datasets when the page starts and when **Refresh data** is clicked.
- Live bus positions come directly from the MTA Bus Time SIRI vehicle-monitoring API after the visitor enters a key. The feed refreshes every five minutes; selecting a route also requests the feed filtered to that route.
- Search and select routes to focus the map and filter its stops and vehicles. Route, stop, and bus layers can be toggled independently.
- Leaflet displays a grayscale CARTO basemap. Route, stop, and bus overlays remain colored.

An internet connection is required for the map tiles, Leaflet CDN, public route/stop datasets, and (if enabled) MTA live feed. Browser access to the MTA API depends on its CORS policy; if the API does not permit cross-origin requests from the Pages origin, direct browser access will fail and a separate server-side proxy will be needed.
