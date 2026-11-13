const ROUTES_URL = 'https://data.ny.gov/resource/bzwk-3hb4.json';
const STOPS_URL = 'https://data.ny.gov/resource/2ucp-7wg5.json';
const VEHICLE_REFRESH_MS = 15_000;

const els = {
  search: document.querySelector('#route-search'),
  select: document.querySelector('#route-select'),
  routes: document.querySelector('#toggle-routes'),
  stops: document.querySelector('#toggle-stops'),
  vehicles: document.querySelector('#toggle-vehicles'),
  routeCount: document.querySelector('#route-count'),
  stopCount: document.querySelector('#stop-count'),
  vehicleCount: document.querySelector('#vehicle-count'),
  statusDot: document.querySelector('#status-indicator'),
  statusTitle: document.querySelector('#status-title'),
  statusMessage: document.querySelector('#status-message'),
  lastUpdated: document.querySelector('#last-updated'),
  mapHeading: document.querySelector('#map-heading'),
  refresh: document.querySelector('#refresh-button')
};

const map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([40.7128, -73.95], 11);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

const routeLayer = L.featureGroup().addTo(map);
const stopLayer = L.layerGroup().addTo(map);
const vehicleLayer = L.layerGroup().addTo(map);
const state = { routes: [], stops: [], vehicles: [], selectedRoute: '', routeLines: [], stopMarkers: [], vehicleMarkers: [], vehicleError: '' };

function setStatus(title, message, kind = 'loading') {
  els.statusTitle.textContent = title;
  els.statusMessage.textContent = message;
  els.statusDot.className = `status-dot ${kind}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function routeName(record) {
  return String(record.route_short_name || record.route_id || 'Bus');
}

function requestUrl(base, fields, where) {
  const query = `SELECT ${fields.map((field) => `\`${field}\``).join(', ')} WHERE ${where}`;
  const url = new URL(base);
  url.searchParams.set('$query', query);
  url.searchParams.set('$limit', '50000');
  return url;
}

function parseVertices(input) {
  if (!input) return null;
  if (typeof input === 'object') return input;
  const text = String(input).trim();
  try { return JSON.parse(text); } catch { /* Try a coordinate-text fallback below. */ }
  const pairs = [...text.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)]
    .map((match) => [Number(match[1]), Number(match[2])]);
  return pairs.length > 1 ? pairs : null;
}

function geometryCoordinates(record) {
  let geometry = record.geometry;
  if (typeof geometry === 'string') {
    try { geometry = JSON.parse(geometry); } catch { geometry = null; }
  }
  if (geometry?.coordinates) return geometry.coordinates;
  const vertices = parseVertices(record.vertices);
  if (vertices?.coordinates) return vertices.coordinates;
  return vertices;
}

function normalizeLines(coordinates) {
  if (!Array.isArray(coordinates) || !coordinates.length) return [];
  const isPosition = (value) => Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
  let lines;
  if (isPosition(coordinates[0])) lines = [coordinates];
  else if (Array.isArray(coordinates[0]) && isPosition(coordinates[0][0])) lines = coordinates;
  else if (Array.isArray(coordinates[0]?.[0]) && isPosition(coordinates[0][0][0])) lines = coordinates.flat();
  else return [];
  return lines.map((line) => line.filter(isPosition).map(([longitude, latitude]) => [Number(latitude), Number(longitude)]))
    .filter((line) => line.length > 1);
}

function routeColor(record) {
  const color = String(record.route_color || '').replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : '#2768d8';
}

function populateRouteSelect() {
  const names = [...new Set(state.routes.map(routeName))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  els.select.replaceChildren(new Option('All routes', ''));
  names.forEach((name) => els.select.add(new Option(name, name)));
}

function matchesSelectedRoute(record) {
  if (!state.selectedRoute) return true;
  return routeName(record).toLowerCase() === state.selectedRoute.toLowerCase();
}

function drawRoutes() {
  routeLayer.clearLayers();
  state.routeLines = [];
  for (const route of state.routes) {
    if (!matchesSelectedRoute(route)) continue;
    const lines = normalizeLines(geometryCoordinates(route));
    if (!lines.length) continue;
    const color = routeColor(route);
    const line = L.featureGroup(lines.map((latlngs) => L.polyline(latlngs, {
      color, weight: state.selectedRoute ? 5 : 3, opacity: state.selectedRoute ? 0.88 : 0.58,
      lineCap: 'round', lineJoin: 'round'
    })));
    const label = routeName(route);
    line.bindPopup(`<div class="popup-title" style="color:${color}">${escapeHtml(label)}</div><div class="popup-detail">${escapeHtml(route.route_long_name || 'MTA bus route')}</div><div class="popup-detail">${escapeHtml(route.direction || '')}</div>`);
    line.addTo(routeLayer);
    state.routeLines.push(line);
  }
  if (els.routes.checked && map.hasLayer(routeLayer)) routeLayer.bringToBack();
}

function stopLatLng(stop) {
  const latitude = Number(stop.latitude ?? stop.georeference?.coordinates?.[1]);
  const longitude = Number(stop.longitude ?? stop.georeference?.coordinates?.[0]);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude !== 0 && longitude !== 0
    ? [latitude, longitude] : null;
}

function drawStops() {
  stopLayer.clearLayers();
  state.stopMarkers = [];
  for (const stop of state.stops) {
    if (!matchesSelectedRoute(stop)) continue;
    const latlng = stopLatLng(stop);
    if (!latlng) continue;
    const marker = L.circleMarker(latlng, {
      radius: 3.2, color: '#ffffff', weight: 1.2, fillColor: '#25364a', fillOpacity: 0.9
    });
    marker.bindPopup(`<div class="popup-title">${escapeHtml(stop.stop_name || 'Bus stop')}</div><div class="popup-detail">Stop ${escapeHtml(stop.stop_id || '—')} · Route ${escapeHtml(routeName(stop))}</div><div class="popup-detail">${escapeHtml(stop.direction || '')}</div>`);
    marker.addTo(stopLayer);
    state.stopMarkers.push(marker);
  }
}

function findValue(object, names) {
  for (const name of names) if (object?.[name] !== undefined && object[name] !== null) return object[name];
  return undefined;
}

function extractVehicles(payload) {
  const service = payload?.Siri?.ServiceDelivery || payload?.siri?.serviceDelivery || payload;
  const activities = service?.VehicleMonitoringDelivery?.[0]?.VehicleActivity
    || service?.vehicleMonitoringDelivery?.[0]?.vehicleActivity || [];
  return activities.map((activity) => {
    const journey = activity.MonitoredVehicleJourney || activity.monitoredVehicleJourney || {};
    const location = journey.VehicleLocation || journey.vehicleLocation || {};
    const latitude = Number(findValue(location, ['Latitude', 'latitude']));
    const longitude = Number(findValue(location, ['Longitude', 'longitude']));
    return {
      latitude, longitude,
      route: String(findValue(journey, ['PublishedLineName', 'publishedLineName', 'LineRef', 'lineRef']) || 'Bus'),
      destination: findValue(journey, ['DestinationName', 'destinationName']),
      vehicle: findValue(journey, ['VehicleRef', 'vehicleRef']),
      bearing: Number(findValue(journey, ['Bearing', 'bearing']))
    };
  }).filter((vehicle) => Number.isFinite(vehicle.latitude) && Number.isFinite(vehicle.longitude));
}

function drawVehicles() {
  vehicleLayer.clearLayers();
  state.vehicleMarkers = [];
  for (const vehicle of state.vehicles) {
    const route = vehicle.route.replace(/^.*:/, '');
    if (state.selectedRoute && route.toLowerCase() !== state.selectedRoute.toLowerCase()) continue;
    const marker = L.circleMarker([vehicle.latitude, vehicle.longitude], {
      radius: 7, color: '#ffffff', weight: 2, fillColor: '#e4443a', fillOpacity: 1
    });
    marker.bindPopup(`<div class="popup-title">Bus ${escapeHtml(route)}</div><div class="popup-detail">${escapeHtml(vehicle.destination || 'Destination unavailable')}</div><div class="popup-detail">Vehicle ${escapeHtml(vehicle.vehicle || '—')}</div>`);
    marker.addTo(vehicleLayer);
    state.vehicleMarkers.push(marker);
  }
  els.vehicleCount.textContent = String(state.vehicleMarkers.length);
}

function syncLayers() {
  for (const [layer, checkbox] of [[routeLayer, els.routes], [stopLayer, els.stops], [vehicleLayer, els.vehicles]]) {
    if (checkbox.checked && !map.hasLayer(layer)) map.addLayer(layer);
    if (!checkbox.checked && map.hasLayer(layer)) map.removeLayer(layer);
  }
}

function applyFilters() {
  const previous = state.selectedRoute;
  state.selectedRoute = els.select.value;
  drawRoutes();
  drawStops();
  drawVehicles();
  syncLayers();
  if (state.selectedRoute) {
    const selectedLines = state.routeLines.flatMap((group) => group.getLayers());
    if (selectedLines.length) {
      const bounds = L.featureGroup(selectedLines).getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [35, 35], maxZoom: 14 });
    }
    els.mapHeading.textContent = `Route ${state.selectedRoute}`;
  } else {
    els.mapHeading.textContent = 'New York City';
    if (previous) map.setView([40.7128, -73.95], 11);
  }
}

function updateRouteOptions(searchTerm = '') {
  const term = searchTerm.trim().toLowerCase();
  const routes = state.routes.filter((route) => `${routeName(route)} ${route.route_long_name || ''}`.toLowerCase().includes(term));
  const names = [...new Set(routes.map(routeName))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const selected = els.select.value;
  els.select.replaceChildren(new Option('All routes', ''));
  names.forEach((name) => els.select.add(new Option(name, name)));
  if (names.includes(selected)) els.select.value = selected;
  applyFilters();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

async function loadNetworkData() {
  setStatus('Loading MTA network', 'Fetching active routes and bus stops…');
  const routeFields = ['valid_from', 'valid_to', 'in_effect', 'route_id', 'route_short_name', 'route_long_name', 'route_description', 'trip_type', 'route_type', 'bundle', 'route_color', 'direction_id', 'direction', 'shape_id', 'vertices', 'shape_length', 'min_longitude', 'min_latitude', 'max_longitude', 'max_latitude', 'geometry'];
  const stopFields = ['valid_from', 'valid_to', 'in_effect', 'route_id', 'route_short_name', 'route_long_name', 'route_description', 'route_color', 'stop_id', 'stop_name', 'direction_id', 'direction', 'revenue_stop', 'timepoint', 'boarding', 'alighting', 'is_cbd', 'latitude', 'longitude', 'bundle', 'georeference'];
  const routeUrl = requestUrl(ROUTES_URL, routeFields, 'caseless_one_of(`in_effect`, "true") AND `trip_type` IN ("1")');
  const stopUrl = requestUrl(STOPS_URL, stopFields, 'caseless_one_of(`in_effect`, "true")');
  const [routeResult, stopResult] = await Promise.allSettled([fetchJson(routeUrl), fetchJson(stopUrl)]);
  if (routeResult.status === 'fulfilled') state.routes = routeResult.value;
  if (stopResult.status === 'fulfilled') state.stops = stopResult.value;
  if (routeResult.status === 'rejected' && stopResult.status === 'rejected') {
    setStatus('Network data unavailable', 'Could not load routes or stops. Check your connection and retry.', 'error');
    throw routeResult.reason;
  }
  populateRouteSelect();
  els.routeCount.textContent = String(new Set(state.routes.map(routeName)).size);
  els.stopCount.textContent = String(state.stops.length);
  updateRouteOptions(els.search.value);
  const messages = [];
  if (routeResult.status === 'rejected') messages.push('Routes could not be loaded');
  if (stopResult.status === 'rejected') messages.push('Stops could not be loaded');
  if (messages.length) setStatus('Partially loaded', `${messages.join('. ')}.`, 'error');
  else if (state.vehicleError) setStatus('Network loaded', 'Routes and stops are ready. Live bus feed is unavailable.', 'error');
  else setStatus('MTA network loaded', 'Routes and stops are up to date.', 'success');
  els.lastUpdated.textContent = `Network updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

async function loadVehicles() {
  try {
    const url = new URL('/api/vehicles', window.location.origin);
    if (state.selectedRoute) url.searchParams.set('lineRef', state.selectedRoute);
    const payload = await fetchJson(url);
    state.vehicles = extractVehicles(payload);
    state.vehicleError = '';
    drawVehicles();
    syncLayers();
    if (state.routes.length || state.stops.length) setStatus('MTA network loaded', 'Routes, stops, and live buses are updating.', 'success');
    els.lastUpdated.textContent = `Live buses updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  } catch (error) {
    state.vehicleError = error.message;
    els.vehicleCount.textContent = '—';
    setStatus('Live bus feed unavailable', error.message, 'error');
    els.lastUpdated.textContent = 'Waiting for live bus feed';
  }
}

els.search.addEventListener('input', () => updateRouteOptions(els.search.value));
els.select.addEventListener('change', () => { applyFilters(); loadVehicles(); });
[els.routes, els.stops, els.vehicles].forEach((checkbox) => checkbox.addEventListener('change', syncLayers));
els.refresh.addEventListener('click', async () => {
  els.refresh.disabled = true;
  try { await loadNetworkData(); } catch { /* Status is already shown in the sidebar. */ }
  await loadVehicles();
  els.refresh.disabled = false;
});

(async function start() {
  try { await loadNetworkData(); } catch { /* Keep the map shell available if the data request fails. */ }
  await loadVehicles();
  window.setInterval(loadVehicles, VEHICLE_REFRESH_MS);
})();
