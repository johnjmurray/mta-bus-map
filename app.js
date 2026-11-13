const ROUTES_URL = 'https://data.ny.gov/resource/bzwk-3hb4.json';
const STOPS_URL = 'https://data.ny.gov/resource/2ucp-7wg5.json';
const VEHICLE_ENDPOINT = 'https://bustime-classic.mta.info/api/siri/vehicle-monitoring.json';
const VEHICLE_REFRESH_MS = 300_000;

const els = {
  search: document.querySelector('#route-search'), select: document.querySelector('#route-select'),
  routes: document.querySelector('#toggle-routes'), stops: document.querySelector('#toggle-stops'), vehicles: document.querySelector('#toggle-vehicles'),
  routeCount: document.querySelector('#route-count'), stopCount: document.querySelector('#stop-count'), vehicleCount: document.querySelector('#vehicle-count'),
  statusDot: document.querySelector('#status-indicator'), statusTitle: document.querySelector('#status-title'),
  statusMessage: document.querySelector('#status-message'), lastUpdated: document.querySelector('#last-updated'),
  mapHeading: document.querySelector('#map-heading'), refresh: document.querySelector('#refresh-button'),
  apiKey: document.querySelector('#api-key'), keyForm: document.querySelector('#api-key-form'), clearKey: document.querySelector('#clear-key')
};

const map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([40.7128, -73.95], 11);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 20,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
}).addTo(map);

const routeLayer = L.featureGroup().addTo(map);
const stopLayer = L.layerGroup().addTo(map);
const vehicleLayer = L.layerGroup().addTo(map);
const state = { routes: [], stops: [], vehicles: [], selectedRoute: '', routeLines: [], vehicleError: '', apiKey: '' };

function setStatus(title, message, kind = 'loading') {
  els.statusTitle.textContent = title;
  els.statusMessage.textContent = message;
  els.statusDot.className = `status-dot ${kind}`;
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function routeName(record) { return String(record.route_short_name || record.route_id || 'Bus'); }
function requestUrl(base, fields, where) {
  const query = `SELECT ${fields.map((field) => `\`${field}\``).join(', ')} WHERE ${where} LIMIT 50000`;
  const url = new URL(base);
  url.searchParams.set('$query', query);
  return url;
}
function parseVertices(input) {
  if (!input) return null;
  if (typeof input === 'object') return input;
  const text = String(input).trim();
  try { return JSON.parse(text); } catch { /* Fall back to coordinate text. */ }
  const pairs = [...text.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)].map((match) => [Number(match[1]), Number(match[2])]);
  return pairs.length > 1 ? pairs : null;
}
function geometryCoordinates(record) {
  let geometry = record.geometry;
  if (typeof geometry === 'string') { try { geometry = JSON.parse(geometry); } catch { geometry = null; } }
  if (geometry?.coordinates) return geometry.coordinates;
  const vertices = parseVertices(record.vertices);
  return vertices?.coordinates || vertices;
}
function normalizeLines(coordinates) {
  if (!Array.isArray(coordinates) || !coordinates.length) return [];
  const isPosition = (value) => Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
  let lines;
  if (isPosition(coordinates[0])) lines = [coordinates];
  else if (Array.isArray(coordinates[0]) && isPosition(coordinates[0][0])) lines = coordinates;
  else if (Array.isArray(coordinates[0]?.[0]) && isPosition(coordinates[0][0][0])) lines = coordinates.flat();
  else return [];
  return lines.map((line) => line.filter(isPosition).map(([longitude, latitude]) => [Number(latitude), Number(longitude)])).filter((line) => line.length > 1);
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
  return !state.selectedRoute || routeName(record).toLowerCase() === state.selectedRoute.toLowerCase();
}
function drawRoutes() {
  routeLayer.clearLayers(); state.routeLines = [];
  for (const route of state.routes) {
    if (!matchesSelectedRoute(route)) continue;
    const lines = normalizeLines(geometryCoordinates(route));
    if (!lines.length) continue;
    const color = routeColor(route);
    const line = L.featureGroup(lines.map((latlngs) => L.polyline(latlngs, { color, weight: state.selectedRoute ? 5 : 3, opacity: state.selectedRoute ? 0.88 : 0.58, lineCap: 'round', lineJoin: 'round' })));
    line.bindPopup(`<strong>${escapeHtml(routeName(route))}</strong><br>${escapeHtml(route.route_long_name || 'MTA bus route')}`);
    line.addTo(routeLayer); state.routeLines.push(line);
  }
  if (els.routes.checked && map.hasLayer(routeLayer)) routeLayer.bringToBack();
}
function stopLatLng(stop) {
  const latitude = Number(stop.latitude ?? stop.georeference?.coordinates?.[1]);
  const longitude = Number(stop.longitude ?? stop.georeference?.coordinates?.[0]);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude !== 0 && longitude !== 0 ? [latitude, longitude] : null;
}
function drawStops() {
  stopLayer.clearLayers();
  for (const stop of state.stops) {
    if (!matchesSelectedRoute(stop)) continue;
    const latlng = stopLatLng(stop);
    if (!latlng) continue;
    L.circleMarker(latlng, { radius: 3.2, color: '#fff', weight: 1.2, fillColor: '#25364a', fillOpacity: 0.9 })
      .bindPopup(`<strong>${escapeHtml(stop.stop_name || 'Bus stop')}</strong><br>Stop ${escapeHtml(stop.stop_id || '—')} · Route ${escapeHtml(routeName(stop))}`).addTo(stopLayer);
  }
}
function findValue(object, names) {
  for (const name of names) if (object?.[name] !== undefined && object[name] !== null) return object[name];
  return undefined;
}
function extractVehicles(payload) {
  const service = payload?.Siri?.ServiceDelivery || payload?.siri?.serviceDelivery || payload;
  const activities = service?.VehicleMonitoringDelivery?.[0]?.VehicleActivity || service?.vehicleMonitoringDelivery?.[0]?.vehicleActivity || [];
  return activities.map((activity) => {
    const journey = activity.MonitoredVehicleJourney || activity.monitoredVehicleJourney || {};
    const location = journey.VehicleLocation || journey.vehicleLocation || {};
    return {
      latitude: Number(findValue(location, ['Latitude', 'latitude'])), longitude: Number(findValue(location, ['Longitude', 'longitude'])),
      route: String(findValue(journey, ['PublishedLineName', 'publishedLineName', 'LineRef', 'lineRef']) || 'Bus'),
      destination: findValue(journey, ['DestinationName', 'destinationName']), vehicle: findValue(journey, ['VehicleRef', 'vehicleRef'])
    };
  }).filter((vehicle) => Number.isFinite(vehicle.latitude) && Number.isFinite(vehicle.longitude));
}
function drawVehicles() {
  vehicleLayer.clearLayers(); let count = 0;
  for (const vehicle of state.vehicles) {
    const route = vehicle.route.replace(/^.*:/, '');
    if (state.selectedRoute && route.toLowerCase() !== state.selectedRoute.toLowerCase()) continue;
    L.circleMarker([vehicle.latitude, vehicle.longitude], { radius: 7, color: '#fff', weight: 2, fillColor: '#e4443a', fillOpacity: 1 })
      .bindPopup(`<strong>Bus ${escapeHtml(route)}</strong><br>${escapeHtml(vehicle.destination || 'Destination unavailable')}<br>Vehicle ${escapeHtml(vehicle.vehicle || '—')}`).addTo(vehicleLayer);
    count++;
  }
  els.vehicleCount.textContent = String(count);
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
  drawRoutes(); drawStops(); drawVehicles(); syncLayers();
  if (state.selectedRoute) {
    const selectedLines = state.routeLines.flatMap((group) => group.getLayers());
    if (selectedLines.length) { const bounds = L.featureGroup(selectedLines).getBounds(); if (bounds.isValid()) map.fitBounds(bounds, { padding: [35, 35], maxZoom: 14 }); }
    els.mapHeading.textContent = `Route ${state.selectedRoute}`;
  } else {
    els.mapHeading.textContent = 'New York City';
    if (previous) map.setView([40.7128, -73.95], 11);
  }
}
function updateRouteOptions(searchTerm = '') {
  const term = searchTerm.trim().toLowerCase();
  const names = [...new Set(state.routes.filter((route) => `${routeName(route)} ${route.route_long_name || ''}`.toLowerCase().includes(term)).map(routeName))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
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
  const routeFields = ['valid_from', 'valid_to', 'in_effect', 'route_id', 'route_short_name', 'route_long_name', 'route_description', 'trip_type', 'route_type', 'bundle', 'route_color', 'direction_id', 'geometry', 'vertices'];
  const stopFields = ['valid_from', 'valid_to', 'in_effect', 'route_id', 'route_short_name', 'route_long_name', 'route_description', 'route_color', 'stop_id', 'stop_name', 'direction_id', 'direction_name', 'latitude', 'longitude', 'georeference'];
  const [routeResult, stopResult] = await Promise.allSettled([
    fetchJson(requestUrl(ROUTES_URL, routeFields, 'caseless_one_of(`in_effect`, "true") AND `trip_type` IN ("1")')),
    fetchJson(requestUrl(STOPS_URL, stopFields, 'caseless_one_of(`in_effect`, "true")'))
  ]);
  if (routeResult.status === 'fulfilled') state.routes = routeResult.value;
  if (stopResult.status === 'fulfilled') state.stops = stopResult.value;
  if (routeResult.status === 'rejected' && stopResult.status === 'rejected') { setStatus('Network data unavailable', 'Could not load routes or stops. Check your connection and retry.', 'error'); throw routeResult.reason; }
  populateRouteSelect();
  els.routeCount.textContent = String(new Set(state.routes.map(routeName)).size);
  els.stopCount.textContent = String(state.stops.length);
  updateRouteOptions(els.search.value);
  const errors = [];
  if (routeResult.status === 'rejected') errors.push('Routes could not be loaded');
  if (stopResult.status === 'rejected') errors.push('Stops could not be loaded');
  if (errors.length) setStatus('Partially loaded', `${errors.join('. ')}.`, 'error');
  else setStatus('MTA network loaded', 'Routes and stops are up to date.', 'success');
  els.lastUpdated.textContent = `Network updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}
async function loadVehicles() {
  if (!state.apiKey) {
    state.vehicles = []; drawVehicles();
    setStatus('API key needed', 'Enter your MTA Bus Time key to load live bus positions.', 'loading');
    return;
  }
  try {
    const url = new URL(VEHICLE_ENDPOINT);
    url.searchParams.set('key', state.apiKey);
    url.searchParams.set('VehicleMonitoringDetailLevel', 'minimum');
    if (state.selectedRoute) url.searchParams.set('LineRef', state.selectedRoute);
    const payload = await fetchJson(url);
    state.vehicles = extractVehicles(payload); drawVehicles(); syncLayers();
    if (state.routes.length || state.stops.length) setStatus('MTA network loaded', 'Routes, stops, and live buses are updating.', 'success');
    els.lastUpdated.textContent = `Live buses updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  } catch (error) {
    state.vehicles = []; drawVehicles();
    setStatus('Live bus feed unavailable', `${error.message}. Check the key and whether the MTA endpoint allows browser requests.`, 'error');
    els.lastUpdated.textContent = 'Waiting for live bus feed';
  }
}
els.search.addEventListener('input', () => updateRouteOptions(els.search.value));
els.select.addEventListener('change', () => { applyFilters(); loadVehicles(); });
[els.routes, els.stops, els.vehicles].forEach((checkbox) => checkbox.addEventListener('change', syncLayers));
els.keyForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  state.apiKey = els.apiKey.value.trim();
  if (!state.apiKey) { setStatus('API key needed', 'Enter your MTA Bus Time key to load live bus positions.', 'error'); return; }
  els.apiKey.value = '';
  els.clearKey.hidden = false;
  await loadVehicles();
});
els.clearKey.addEventListener('click', () => {
  state.apiKey = ''; state.vehicles = []; drawVehicles(); els.clearKey.hidden = true;
  setStatus('API key cleared', 'Enter your MTA Bus Time key to load live bus positions.', 'loading');
});
els.refresh.addEventListener('click', async () => {
  els.refresh.disabled = true;
  try { await loadNetworkData(); } catch { /* Status is already shown. */ }
  await loadVehicles();
  els.refresh.disabled = false;
});
(async function start() {
  try { await loadNetworkData(); } catch { /* Keep the map shell available if data is unavailable. */ }
  setStatus('API key needed', 'Enter your MTA Bus Time key to load live bus positions.', 'loading');
})();
window.setInterval(() => { if (state.apiKey) loadVehicles(); }, VEHICLE_REFRESH_MS);
