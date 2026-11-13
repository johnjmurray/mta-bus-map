# MTA Bus Map

A static interactive map of active MTA bus routes, stops, and live bus positions, suitable for GitHub Pages.

## Route selection and styling

Search routes and check one or more entries to display their route shapes and filter live buses. Use **Select all ACE routes** to fetch the ACE program route list from NY Open Data (`ki2b-sg5y`) and select the matching active route shapes. Each selected route has its own color picker and opacity slider. These style choices apply to the map for the current page session.

Bus stops remain visible regardless of route selection, and stop tooltips list all routes serving each stop.

## Live bus access and privacy

Live bus tracking is optional. A visitor enters their own MTA Bus Time API key in the page to enable it. The key stays in page memory for that visit and is cleared on reload or with **Clear key**; it is not stored in local storage, cookies, or this repository. Requests go directly from the visitor's browser to MTA, so the key is visible to that visitor. Do not enter a key unless you are authorized to use it. The Codespaces secret is not available to GitHub Pages.

## Deploy to GitHub Pages

In repository **Settings → Pages**, choose the publishing source/branch and folder containing `index.html`, then save. The site is static; no build step or npm installation is required.

## Data and behavior

- Active route shapes and stop information load from NY Open Data Socrata datasets when the page starts and when **Refresh data** is clicked.
- Live bus positions come directly from the MTA Bus Time SIRI vehicle-monitoring API after a visitor provides a key. The feed refreshes every five minutes. For a single selection the request is route-filtered; multiple selections fetch the feed and filter returned buses in the browser.
- Leaflet displays a grayscale CARTO basemap with a dark, squared-off control theme. An internet connection is required. Direct browser access to the MTA API depends on its CORS policy; if the API does not permit cross-origin requests from the Pages origin, a separate server-side proxy will be needed.
