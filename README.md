# MTA Bus Map

An interactive map of active MTA bus routes, stops, and live bus positions.

## Route selection and styling

Search routes and check one or more entries to display their route shapes and filter live buses. Use **Select all routes** or **Select no routes** to quickly update the selection. Use **Select all ACE routes** to select active routes in the ACE dataset. Route color and opacity can be customized for selected routes.

## Live bus access and privacy

Live bus tracking is optional. A visitor enters their own MTA Bus Time API key in the page to enable it. The key stays in page memory for that visit and is cleared on reload or with **Clear key**; it is not saved or sent anywhere except the MTA Bus Time API.

## Data and behavior

- Active route shapes and stop information load from NY Open Data Socrata datasets when the page starts and when **Refresh data** is clicked.
- Live bus positions come directly from the MTA Bus Time SIRI vehicle-monitoring API after a visitor provides a key. The feed refreshes every five minutes. For a single selection the request is route-filtered; multiple selections fetch the feed and filter returned buses in the browser.
- Bus markers point in the direction of travel, use a fill color based on the route prefix, and use an outline color based on the NYCT or MTABC agency.
- Bus tooltips show the fleet number, route name, agency, and destination. Use **Find bus number** to highlight a matching bus.
- NYC DOT Street Sign Work Orders are fetched only when **Fetch signs in current view** is clicked. The viewport must be no more than 1,000 feet wide. The API returns `sign_x_coord` and `sign_y_coord` values in New York State Plane (EPSG:2263); the app queries those projected bounds and converts each returned point to WGS84 for Leaflet rendering. Signs are drawn as canvas-backed markers and can be hidden with the Street signs layer toggle.

## TODO
- ACE route selection is missing the SBS routes
- ingest custom geojson
- map viewer enhancements
