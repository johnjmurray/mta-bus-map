const ROUTES_URL = 'https://data.ny.gov/resource/bzwk-3hb4.json';
const STOPS_URL = 'https://data.ny.gov/resource/2ucp-7wg5.json';
const ACE_URL = 'https://data.ny.gov/resource/ki2b-sg5y.json';
const VEHICLE_ENDPOINT = 'https://bustime-classic.mta.info/api/siri/vehicle-monitoring.json';
const VEHICLE_REFRESH_MS = 300_000;

const els = {
  search: document.querySelector('#route-search'), routeList: document.querySelector('#route-list'),
  routeStyles: document.querySelector('#route-styles'), selectAce: document.querySelector('#select-ace'),
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
const state = { routes: [], stops: [], vehicles: [], selectedRoutes: new Set(), routeLines: [], routeStyles: new Map(), apiKey: '' };

function setStatus(title, message, kind = 'loading') {
  els.statusTitle.textContent = title;
  els.statusMessage.textContent = message;
  els.statusDot.className = `status-dot ${kind}`;
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function routeName(record) { return String(record.route_short_name || record.route_id || 'Bus'); }
function routeKey(name) { return String(name).trim().toLowerCase(); }
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
function sortedRouteNames() {
  return [...new Set(state.routes.map(routeName))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
function ensureRouteStyle(route) {
  const key = routeKey(route);
  if (!state.routeStyles.has(key)) {
    const record = state.routes.find((item) => routeKey(routeName(item)) === key);
    state.routeStyles.set(key, { color: routeColor(record || {}), opacity: 0.8 });
  }
  return state.routeStyles.get(key);
}
function renderRoutePicker() {
  const term = els.search.value.trim().toLowerCase();
  const names = sortedRouteNames().filter((name) => {
    const records = state.routes.filter((route) => routeKey(routeName(route)) === routeKey(name));
    return `${name} ${records.map((route) => route.route_long_name || '').join(' ')}`.toLowerCase().includes(term);
  });
  els.routeList.replaceChildren();
  for (const name of names) {
    const label = document.createElement('label');
    label.className = 'route-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.value = name; checkbox.checked = state.selectedRoutes.has(name);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.selectedRoutes.add(name);
      else state.selectedRoutes.delete(name);
      applyFilters();
      loadVehicles();
    });
    const text = document.createElement('span'); text.textContent = name;
    label.append(checkbox, text); els.routeList.append(label);
  }
  renderRouteStyles();
}
function renderRouteStyles() {
  els.routeStyles.replaceChildren();
  if (!state.selectedRoutes.size) {
    const note = document.createElement('p'); note.className = 'route-style-empty'; note.textContent = 'Select route(s) to customize line color and opacity.';
    els.routeStyles.append(note); return;
  }
  for (const route of [...state.selectedRoutes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const style = ensureRouteStyle(route);
    const row = document.createElement('div'); row.className = 'route-style-row';
    const name = document.createElement('strong'); name.textContent = route;
    const colorLabel = document.createElement('label'); colorLabel.textContent = 'Color';
    const colorInput = document.createElement('input'); colorInput.type = 'color'; colorInput.value = style.color; colorInput.setAttribute('aria-label', `${route} line color`);
    colorInput.addEventListener('input', () => { style.color = colorInput.value; drawRoutes(); });
    colorLabel.append(colorInput);
    const opacityLabel = document.createElement('label'); opacityLabel.className = 'opacity-control';
    const opacityText = document.createElement('span'); opacityText.textContent = `Opacity ${Math.round(style.opacity * 100)}%`;
    const opacityInput = document.createElement('input'); opacityInput.type = 'range'; opacityInput.min = '10'; opacityInput.max = '100'; opacityInput.value = String(Math.round(style.opacity * 100)); opacityInput.setAttribute('aria-label', `${route} line opacity`);
    opacityInput.addEventListener('input', () => { style.opacity = Number(opacityInput.value) / 100; opacityText.textContent = `Opacity ${opacityInput.value}%`; drawRoutes(); });
    opacityLabel.append(opacityText, opacityInput);
    row.append(name, colorLabel, opacityLabel); els.routeStyles.append(row);
  }
}
function drawRoutes() {
  routeLayer.clearLayers(); state.routeLines = [];
  for (const route of state.routes) {
    const name = routeName(route);
    if (state.selectedRoutes.size && !state.selectedRoutes.has(name)) continue;
    const lines = normalizeLines(geometryCoordinates(route));
    if (!lines.length) continue;
    const style = ensureRouteStyle(name);
    const line = L.featureGroup(lines.map((latlngs) => L.polyline(latlngs, { color: style.color, weight: state.selectedRoutes.size ? 5 : 3, opacity: style.opacity, lineCap: 'round', lineJoin: 'round' })));
    line.bindPopup(`<strong>${escapeHtml(name)}</strong><br>${escapeHtml(route.route_long_name || 'MTA bus route')}`);
    line.addTo(routeLayer); state.routeLines.push(line);
  }
  if (els.routes.checked && map.hasLayer(routeLayer)) routeLayer.bringToBack();
}
function stopLatLng(stop) {
  const latitude = Number(stop.latitude ?? stop.georeference?.coordinates?.[1]);
  const longitude = Number(stop.longitude ?? stop.georeference?.coordinates?.[0]);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude !== 0 && longitude !== 0 ? [latitude, longitude] : null;
}
function stopsWithRoutes() {
  const grouped = new Map();
  for (const stop of state.stops) {
    const latlng = stopLatLng(stop);
    if (!latlng) continue;
    const key = stop.stop_id ? `id:${stop.stop_id}` : `loc:${latlng.join(',')}:${stop.stop_name || ''}`;
    let entry = grouped.get(key);
    if (!entry) { entry = { ...stop, latlng, servedRoutes: new Set() }; grouped.set(key, entry); }
    const route = String(stop.route_short_name || stop.route_id || '').trim();
    if (route) entry.servedRoutes.add(route);
  }
  return [...grouped.values()];
}
function drawStops() {
  stopLayer.clearLayers();
  for (const stop of stopsWithRoutes()) {
    const routes = [...stop.servedRoutes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const routeText = routes.length ? routes.map(escapeHtml).join(', ') : 'Not specified';
    const marker = L.circleMarker(stop.latlng, { radius: 3.2, color: '#ffffff', weight: 1.2, fillColor: '#25364a', fillOpacity: 0.9 });
    marker.bindTooltip(`<strong>${escapeHtml(stop.stop_name || 'Bus stop')}</strong><br>Stop ${escapeHtml(stop.stop_id || '—')}<br>Routes: ${routeText}`, { direction: 'top', opacity: 0.96 });
    marker.bindPopup(`<strong>${escapeHtml(stop.stop_name || 'Bus stop')}</strong><br>Stop ${escapeHtml(stop.stop_id || '—')}<br>Routes: ${routeText}`);
    marker.addTo(stopLayer);
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
    if (state.selectedRoutes.size && ![...state.selectedRoutes].some((name) => routeKey(name) === routeKey(route))) continue;
    L.circleMarker([vehicle.latitude, vehicle.longitude], { radius: 7, color: '#ffffff', weight: 2, fillColor: '#e4443a', fillOpacity: 1 })
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
  drawRoutes(); drawStops(); drawVehicles(); syncLayers();
  if (state.selectedRoutes.size) {
    const selectedNames = [...state.selectedRoutes];
    const selectedLines = state.routeLines.flatMap((group) => group.getLayers());
    if (selectedLines.length) { const bounds = L.featureGroup(selectedLines).getBounds(); if (bounds.isValid()) map.fitBounds(bounds, { padding: [35, 35], maxZoom: 14 }); }
    els.mapHeading.textContent = selectedNames.length <= 3 ? selectedNames.join(', ') : `${selectedNames.length} routes selected`;
  } else {
    els.mapHeading.textContent = 'New York City';
  }
  renderRouteStyles();
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
  state.selectedRoutes = new Set([...state.selectedRoutes].filter((name) => sortedRouteNames().includes(name)));
  els.routeCount.textContent = String(new Set(state.routes.map(routeName)).size);
  els.stopCount.textContent = String(stopsWithRoutes().length);
  renderRoutePicker(); applyFilters();
  const errors = [];
  if (routeResult.status === 'rejected') errors.push('Routes could not be loaded');
  if (stopResult.status === 'rejected') errors.push('Stops could not be loaded');
  if (errors.length) setStatus('Partially loaded', `${errors.join('. ')}.`, 'error');
  else setStatus('MTA network loaded', 'Routes and stops are up to date.', 'success');
  els.lastUpdated.textContent = `Network updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}
async function selectAceRoutes() {
  els.selectAce.disabled = true;
  try {
    const url = new URL(ACE_URL);
    url.searchParams.set('$query', 'SELECT `route`, `program`, `implementation_date` WHERE caseless_one_of(`program`, "ACE") LIMIT 50000');
    const aceRecords = await fetchJson(url);
    const aceNames = new Set(aceRecords.map((record) => routeKey(record.route)).filter(Boolean));
    const matches = sortedRouteNames().filter((name) => aceNames.has(routeKey(name)));
    if (!matches.length) {
      setStatus('No ACE routes matched', 'The ACE dataset loaded, but no route names matched the active route shapes.', 'error');
      return;
    }
    state.selectedRoutes = new Set(matches);
    els.search.value = '';
    renderRoutePicker(); applyFilters(); await loadVehicles();
    setStatus('ACE routes selected', `${matches.length} active route shapes matched the ACE program dataset.`, 'success');
  } catch (error) {
    setStatus('ACE route list unavailable', `Could not load ACE routes: ${error.message}`, 'error');
  } finally { els.selectAce.disabled = false; }
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
    if (state.selectedRoutes.size === 1) url.searchParams.set('LineRef', [...state.selectedRoutes][0]);
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
els.search.addEventListener('input', renderRoutePicker);
els.selectAce.addEventListener('click', selectAceRoutes);
[els.routes, els.stops, els.vehicles].forEach((checkbox) => checkbox.addEventListener('change', syncLayers));
els.keyForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  state.apiKey = els.apiKey.value.trim();
  if (!state.apiKey) { setStatus('API key needed', 'Enter your MTA Bus Time key to load live bus positions.', 'error'); return; }
  els.apiKey.value = ''; els.clearKey.hidden = false;
  await loadVehicles();
});
els.clearKey.addEventListener('click', () => {
  state.apiKey = ''; state.vehicles = []; drawVehicles(); els.clearKey.hidden = true;
  setStatus('API key cleared', 'Enter your MTA Bus Time key to load live bus positions.', 'loading');
});
els.refresh.addEventListener('click', async () => {
  els.refresh.disabled = true;
  try { await loadNetworkData(); } catch { /* Status is already shown. */ }
  await loadVehicles(); els.refresh.disabled = false;
});
(async function start() {
  try { await loadNetworkData(); } catch { /* Keep the map shell available if data is unavailable. */ }
  setStatus('API key needed', 'Enter your MTA Bus Time key to load live bus positions.', 'loading');
})();
window.setInterval(() => { if (state.apiKey) loadVehicles(); }, VEHICLE_REFRESH_MS);
