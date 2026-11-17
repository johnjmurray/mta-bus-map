const CONFIG = {
  routesUrl: 'https://data.ny.gov/resource/bzwk-3hb4.json',
  stopsUrl: 'https://data.ny.gov/resource/2ucp-7wg5.json',
  aceUrl: 'https://data.ny.gov/resource/ki2b-sg5y.json',
  vehicleUrl: 'https://bustime-classic.mta.info/api/siri/vehicle-monitoring.json',
  vehicleRefreshMs: 300_000,
  requestTimeoutMs: 20_000,
  mapCenter: [40.7128, -73.95],
  mapZoom: 11
};

const VEHICLE_ROUTE_COLORS = {
  M: '#2d8cff', Q: '#ff8a3d', BX: '#7a5cff', B: '#3ecf8e', S: '#e86f6f',
  QM: '#ffb703', BXM: '#6c63ff', X: '#f15bb5', SIM: '#7dd3fc',
  DEFAULT: '#f7f7f7'
};
const AGENCY_COLORS = { NYCT: '#3fa9f5', MTABC: '#e76f51', DEFAULT: '#dfe6ee' };
const ROUTE_PREFIX_PATTERN = /^(BXM|QM|SIM|BX|M|Q|B|S|X)(?=\d|\s|_|-|$)/i;

const els = {
  search: document.querySelector('#route-search'),
  busSearch: document.querySelector('#bus-search'),
  routeList: document.querySelector('#route-list'),
  routeStyles: document.querySelector('#route-styles'),
  selectAce: document.querySelector('#select-ace'),
  selectAllRoutes: document.querySelector('#select-all-routes'),
  selectNoRoutes: document.querySelector('#select-no-routes'),
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
  refresh: document.querySelector('#refresh-button'),
  apiKey: document.querySelector('#api-key'),
  keyForm: document.querySelector('#api-key-form'),
  clearKey: document.querySelector('#clear-key')
};

const map = L.map('map', { zoomControl: false, preferCanvas: true })
  .setView(CONFIG.mapCenter, CONFIG.mapZoom);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

const layers = {
  routes: L.featureGroup().addTo(map),
  stops: L.layerGroup().addTo(map),
  vehicles: L.layerGroup().addTo(map)
};

const state = {
  routes: [],
  stops: [],
  vehicles: [],
  selectedRoutes: new Set(),
  allRoutesSelected: true,
  routeLines: [],
  routeStyles: new Map(),
  apiKey: '',
  vehicleRequest: null,
  vehicleRequestId: 0
};

// General helpers
function setStatus(title, message, kind = 'loading') {
  els.statusTitle.textContent = title;
  els.statusMessage.textContent = message;
  els.statusDot.className = `status-dot ${kind}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function routeName(record) {
  return String(record.route_short_name || record.route_id || 'Bus').trim();
}

function routeKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

function vehicleRouteName(value) {
  const normalized = String(value ?? '').replace(/^MTA\s+/i, '').replace(/_/g, ' ').trim();
  const match = normalized.match(ROUTE_PREFIX_PATTERN);
  if (!match) return normalized.split(/\s+/)[0] || normalized;
  const rest = normalized.slice(match[0].length).match(/^\s*\d+[A-Za-z]?/);
  return `${match[0]}${rest?.[0] || ''}`.replace(/\s+/g, '').toUpperCase();
}

function timestampLabel(prefix) {
  return `${prefix} ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function requestUrl(base, fields, where) {
  const query = `SELECT ${fields.map((field) => `\`${field}\``).join(', ')} WHERE ${where} LIMIT 50000`;
  const url = new URL(base);
  url.searchParams.set('$query', query);
  return url;
}

async function fetchJson(url, { signal, timeoutMs = CONFIG.requestTimeoutMs } = {}) {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError' && !signal?.aborted) {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

// Bus identity, icon, and popup formatting
function normalizeVehicleName(raw) {
  const value = String(raw ?? '').trim().replace(/^MTA\s+/i, '');
  if (!value) return { number: '—', agency: 'Unknown' };

  const number = value.match(/\d{3,5}/)?.[0] || '—';
  const agencyMatch = value.match(/\b(NYCT|MTABC)\b/i)?.[1]?.toUpperCase();
  const routePrefix = value.match(ROUTE_PREFIX_PATTERN)?.[1]?.toUpperCase();
  return {
    number,
    agency: agencyMatch || routePrefix || 'Unknown'
  };
}

function buildBusIcon(vehicle) {
  const display = normalizeVehicleName(vehicle.vehicle || vehicle.route || 'Bus');
  const prefix = vehicleRouteName(vehicle.route || vehicle.vehicle || '').match(ROUTE_PREFIX_PATTERN)?.[1]?.toUpperCase();
  const fillColor = VEHICLE_ROUTE_COLORS[prefix] || VEHICLE_ROUTE_COLORS.DEFAULT;
  const borderColor = AGENCY_COLORS[display.agency] || AGENCY_COLORS.DEFAULT;
  const heading = Number(vehicle.heading ?? vehicle.bearing ?? 0);
  const highlighted = Boolean(vehicle.searchMatch);
  const html = `<div class="bus-marker ${highlighted ? 'highlighted' : ''}" style="--bus-fill:${fillColor};--bus-border:${borderColor};--bus-rotation:${heading}deg"><span>${escapeHtml(display.number)}</span></div>`;

  return L.divIcon({
    className: 'bus-marker-wrapper',
    html,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -12]
  });
}

function formatVehicleTooltip(vehicle) {
  const display = normalizeVehicleName(vehicle.vehicle || vehicle.route || 'Bus');
  const route = vehicle.routeName || vehicle.route || 'Bus';
  return `<div class="bus-tooltip"><strong>${escapeHtml(display.number)} (${escapeHtml(route)})</strong><div>${escapeHtml(display.agency)}</div><div>${escapeHtml(vehicle.destination || 'Destination unavailable')}</div></div>`;
}

function buildVehiclePopup(vehicle) {
  const display = normalizeVehicleName(vehicle.vehicle || vehicle.route || 'Bus');
  return `<strong>Bus ${escapeHtml(display.number)}</strong><br>${escapeHtml(vehicle.routeName || vehicle.route || 'Bus')}<br>${escapeHtml(display.agency)}<br>${escapeHtml(vehicle.destination || 'Destination unavailable')}`;
}

function updateBusHighlights() {
  const term = els.busSearch.value.trim().toLowerCase();
  for (const vehicle of state.vehicles) {
    const number = normalizeVehicleName(vehicle.vehicle || vehicle.route || '').number;
    vehicle.searchMatch = Boolean(term) && number.toLowerCase() === term;
  }
}

// Route and geometry handling
function parseVertices(input) {
  if (!input) return null;
  if (typeof input === 'object') return input;
  const text = String(input).trim();
  try {
    return JSON.parse(text);
  } catch {
    const pairs = [...text.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)]
      .map((match) => [Number(match[1]), Number(match[2])]);
    return pairs.length > 1 ? pairs : null;
  }
}

function geometryCoordinates(record) {
  let geometry = record.geometry;
  if (typeof geometry === 'string') {
    try { geometry = JSON.parse(geometry); } catch { geometry = null; }
  }
  if (geometry?.coordinates) return geometry.coordinates;
  const vertices = parseVertices(record.vertices);
  return vertices?.coordinates || vertices;
}

function normalizeLines(coordinates) {
  if (!Array.isArray(coordinates) || !coordinates.length) return [];
  const isPosition = (value) => Array.isArray(value) && value.length >= 2 &&
    Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));

  let lines;
  if (isPosition(coordinates[0])) lines = [coordinates];
  else if (Array.isArray(coordinates[0]) && isPosition(coordinates[0][0])) lines = coordinates;
  else if (Array.isArray(coordinates[0]?.[0]) && isPosition(coordinates[0][0][0])) lines = coordinates.flat();
  else return [];

  return lines
    .map((line) => line.filter(isPosition).map(([longitude, latitude]) => [Number(latitude), Number(longitude)]))
    .filter((line) => line.length > 1);
}

function routeColor(record) {
  const color = String(record.route_color || '').replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : '#2768d8';
}

function sortedRouteNames() {
  return [...new Set(state.routes.map(routeName))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function ensureRouteStyle(name) {
  const key = routeKey(name);
  if (!state.routeStyles.has(key)) {
    const record = state.routes.find((item) => routeKey(routeName(item)) === key);
    state.routeStyles.set(key, { color: routeColor(record || {}), opacity: 0.8 });
  }
  return state.routeStyles.get(key);
}

function renderRouteStyles() {
  els.routeStyles.replaceChildren();
  if (!state.selectedRoutes.size) {
    const note = document.createElement('p');
    note.className = 'route-style-empty';
    note.textContent = state.allRoutesSelected
      ? 'Select specific routes to customize line color and opacity.'
      : 'No routes selected.';
    els.routeStyles.append(note);
    return;
  }

  for (const route of [...state.selectedRoutes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const style = ensureRouteStyle(route);
    const row = document.createElement('div');
    row.className = 'route-style-row';
    const name = document.createElement('strong');
    name.textContent = route;

    const colorLabel = document.createElement('label');
    colorLabel.textContent = 'Color';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = style.color;
    colorInput.setAttribute('aria-label', `${route} line color`);
    colorInput.addEventListener('input', () => {
      style.color = colorInput.value;
      drawRoutes();
    });
    colorLabel.append(colorInput);

    const opacityLabel = document.createElement('label');
    opacityLabel.className = 'opacity-control';
    const opacityText = document.createElement('span');
    opacityText.textContent = `Opacity ${Math.round(style.opacity * 100)}%`;
    const opacityInput = document.createElement('input');
    opacityInput.type = 'range';
    opacityInput.min = '10';
    opacityInput.max = '100';
    opacityInput.value = String(Math.round(style.opacity * 100));
    opacityInput.setAttribute('aria-label', `${route} line opacity`);
    opacityInput.addEventListener('input', () => {
      style.opacity = Number(opacityInput.value) / 100;
      opacityText.textContent = `Opacity ${opacityInput.value}%`;
      drawRoutes();
    });
    opacityLabel.append(opacityText, opacityInput);
    row.append(name, colorLabel, opacityLabel);
    els.routeStyles.append(row);
  }
}

function renderRoutePicker() {
  const term = els.search.value.trim().toLowerCase();
  const names = sortedRouteNames().filter((name) => {
    const longNames = state.routes
      .filter((route) => routeKey(routeName(route)) === routeKey(name))
      .map((route) => route.route_long_name || '')
      .join(' ');
    return `${name} ${longNames}`.toLowerCase().includes(term);
  });

  els.routeList.replaceChildren();
  for (const name of names) {
    const label = document.createElement('label');
    label.className = 'route-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = name;
    checkbox.checked = state.allRoutesSelected || state.selectedRoutes.has(name);
    checkbox.addEventListener('change', () => {
      if (state.allRoutesSelected) {
        state.selectedRoutes = new Set(sortedRouteNames());
        state.allRoutesSelected = false;
      }
      if (checkbox.checked) state.selectedRoutes.add(name);
      else state.selectedRoutes.delete(name);
      renderRoutePicker();
      applyFilters({ fitMap: true });
      loadVehicles();
    });
    const text = document.createElement('span');
    text.textContent = name;
    label.append(checkbox, text);
    els.routeList.append(label);
  }
  renderRouteStyles();
}

function drawRoutes() {
  layers.routes.clearLayers();
  state.routeLines = [];

  for (const route of state.routes) {
    const name = routeName(route);
    if (!state.allRoutesSelected && !state.selectedRoutes.has(name)) continue;
    const lines = normalizeLines(geometryCoordinates(route));
    if (!lines.length) continue;

    const style = ensureRouteStyle(name);
    const group = L.featureGroup(lines.map((latlngs) => L.polyline(latlngs, {
      color: style.color,
      weight: state.allRoutesSelected ? 3 : 5,
      opacity: style.opacity,
      lineCap: 'round',
      lineJoin: 'round'
    })));
    group.bindPopup(`<strong>${escapeHtml(name)}</strong><br>${escapeHtml(route.route_long_name || 'MTA bus route')}`);
    group.addTo(layers.routes);
    state.routeLines.push(group);
  }

  if (els.routes.checked && map.hasLayer(layers.routes)) layers.routes.bringToBack();
}

// Stops
function stopLatLng(stop) {
  const latitude = Number(stop.latitude ?? stop.georeference?.coordinates?.[1]);
  const longitude = Number(stop.longitude ?? stop.georeference?.coordinates?.[0]);
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180 &&
    latitude !== 0 && longitude !== 0 ? [latitude, longitude] : null;
}

function stopsWithRoutes() {
  const grouped = new Map();
  for (const stop of state.stops) {
    const latlng = stopLatLng(stop);
    if (!latlng) continue;
    const key = stop.stop_id ? `id:${stop.stop_id}` : `loc:${latlng.join(',')}:${stop.stop_name || ''}`;
    let entry = grouped.get(key);
    if (!entry) {
      entry = { ...stop, latlng, servedRoutes: new Set() };
      grouped.set(key, entry);
    }
    const route = String(stop.route_short_name || stop.route_id || '').trim();
    if (route) entry.servedRoutes.add(route);
  }
  return [...grouped.values()];
}

function drawStops() {
  layers.stops.clearLayers();
  for (const stop of stopsWithRoutes()) {
    const routes = [...stop.servedRoutes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const routeText = routes.length ? routes.map(escapeHtml).join(', ') : 'Not specified';
    const name = escapeHtml(stop.stop_name || 'Bus stop');
    const id = escapeHtml(stop.stop_id || '—');
    const details = `<strong>${name}</strong><br>Stop ${id}<br>Routes: ${routeText}`;
    L.circleMarker(stop.latlng, {
      radius: 3.2, color: '#ffffff', weight: 1.2, fillColor: '#25364a', fillOpacity: 0.9
    })
      .bindTooltip(details, { direction: 'top', opacity: 0.96 })
      .bindPopup(details)
      .addTo(layers.stops);
  }
}

// Live vehicle data
function findValue(object, names) {
  for (const name of names) {
    if (object?.[name] !== undefined && object[name] !== null) return object[name];
  }
  return undefined;
}

function extractVehicles(payload) {
  const service = payload?.Siri?.ServiceDelivery || payload?.siri?.serviceDelivery || payload;
  const activities = service?.VehicleMonitoringDelivery?.[0]?.VehicleActivity ||
    service?.vehicleMonitoringDelivery?.[0]?.vehicleActivity || [];

  return activities.map((activity) => {
    const journey = activity.MonitoredVehicleJourney || activity.monitoredVehicleJourney || {};
    const location = journey.VehicleLocation || journey.vehicleLocation || {};
    return {
      latitude: Number(findValue(location, ['Latitude', 'latitude'])),
      longitude: Number(findValue(location, ['Longitude', 'longitude'])),
      route: String(findValue(journey, ['PublishedLineName', 'publishedLineName', 'LineRef', 'lineRef']) || 'Bus'),
      destination: findValue(journey, ['DestinationName', 'destinationName']),
      vehicle: findValue(journey, ['VehicleRef', 'vehicleRef'])
    };
  }).filter((vehicle) => Number.isFinite(vehicle.latitude) && Number.isFinite(vehicle.longitude) &&
    vehicle.latitude >= -90 && vehicle.latitude <= 90 && vehicle.longitude >= -180 && vehicle.longitude <= 180);
}

function vehicleMatchesSelectedRoutes(vehicle) {
  if (state.allRoutesSelected) return true;
  const normalizedRoute = routeKey(vehicleRouteName(vehicle.route || vehicle.vehicle || ''));
  return [...state.selectedRoutes].some((name) => routeKey(name) === normalizedRoute);
}

function drawVehicles() {
  layers.vehicles.clearLayers();
  let count = 0;

  for (const vehicle of state.vehicles) {
    if (!vehicleMatchesSelectedRoutes(vehicle)) continue;
    L.marker([vehicle.latitude, vehicle.longitude], { icon: buildBusIcon(vehicle) })
      .bindPopup(buildVehiclePopup(vehicle))
      .bindTooltip(formatVehicleTooltip(vehicle), { direction: 'top', offset: [0, -6], opacity: 0.96 })
      .addTo(layers.vehicles);
    count++;
  }
  els.vehicleCount.textContent = String(count);
}

function syncLayers() {
  for (const [layer, checkbox] of [
    [layers.routes, els.routes], [layers.stops, els.stops], [layers.vehicles, els.vehicles]
  ]) {
    if (checkbox.checked && !map.hasLayer(layer)) map.addLayer(layer);
    else if (!checkbox.checked && map.hasLayer(layer)) map.removeLayer(layer);
  }
}

function applyFilters({ fitMap = false } = {}) {
  drawRoutes();
  drawStops();
  drawVehicles();
  syncLayers();

  if (state.allRoutesSelected) {
    els.mapHeading.textContent = 'New York City';
  } else if (state.selectedRoutes.size) {
    const selectedNames = [...state.selectedRoutes];
    if (fitMap && state.routeLines.length) {
      const lines = state.routeLines.flatMap((group) => group.getLayers());
      const bounds = L.featureGroup(lines).getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [35, 35], maxZoom: 14 });
    }
    els.mapHeading.textContent = selectedNames.length <= 3
      ? selectedNames.join(', ')
      : `${selectedNames.length} routes selected`;
  } else {
    els.mapHeading.textContent = 'No routes selected';
  }
  renderRouteStyles();
}

async function loadNetworkData() {
  setStatus('Loading MTA network', 'Fetching active routes and bus stops…');
  const routeFields = [
    'valid_from', 'valid_to', 'in_effect', 'route_id', 'route_short_name', 'route_long_name',
    'route_description', 'trip_type', 'route_type', 'bundle', 'route_color', 'direction_id', 'geometry', 'vertices'
  ];
  const stopFields = [
    'valid_from', 'valid_to', 'in_effect', 'route_id', 'route_short_name', 'route_long_name',
    'route_description', 'route_color', 'stop_id', 'stop_name', 'direction_id', 'latitude',
    'longitude', 'georeference'
  ];
  const [routeResult, stopResult] = await Promise.allSettled([
    fetchJson(requestUrl(CONFIG.routesUrl, routeFields, 'caseless_one_of(`in_effect`, "true") AND `trip_type` IN ("1","14")')),
    fetchJson(requestUrl(CONFIG.stopsUrl, stopFields, 'caseless_one_of(`in_effect`, "true")'))
  ]);

  if (routeResult.status === 'fulfilled') state.routes = routeResult.value;
  if (stopResult.status === 'fulfilled') state.stops = stopResult.value;
  if (routeResult.status === 'rejected' && stopResult.status === 'rejected') {
    setStatus('Network data unavailable', 'Could not load routes or stops. Check your connection and retry.', 'error');
    throw routeResult.reason;
  }

  const availableRoutes = new Set(sortedRouteNames().map(routeKey));
  state.selectedRoutes = new Set([...state.selectedRoutes].filter((name) => availableRoutes.has(routeKey(name))));
  els.routeCount.textContent = String(new Set(state.routes.map(routeName)).size);
  els.stopCount.textContent = String(stopsWithRoutes().length);
  renderRoutePicker();
  applyFilters();

  const errors = [];
  if (routeResult.status === 'rejected') errors.push('Routes could not be loaded');
  if (stopResult.status === 'rejected') errors.push('Stops could not be loaded');
  if (errors.length) setStatus('Partially loaded', `${errors.join('. ')}.`, 'error');
  else setStatus('MTA network loaded', 'Routes and stops are up to date.', 'success');
  els.lastUpdated.textContent = timestampLabel('Network updated');
}

async function selectAceRoutes() {
  els.selectAce.disabled = true;
  try {
    const url = new URL(CONFIG.aceUrl);
    url.searchParams.set('$query', 'SELECT `route`, `program`, `implementation_date` WHERE caseless_one_of(`program`, "ACE") LIMIT 50000');
    const records = await fetchJson(url);
    const aceNames = new Set(records.map((record) => routeKey(record.route)).filter(Boolean));
    const matches = sortedRouteNames().filter((name) => aceNames.has(routeKey(name)));

    if (!matches.length) {
      setStatus('No ACE routes matched', 'The ACE dataset loaded, but no route names matched the active route shapes.', 'error');
      return;
    }

    state.selectedRoutes = new Set(matches);
    state.allRoutesSelected = false;
    els.search.value = '';
    renderRoutePicker();
    applyFilters({ fitMap: true });
    await loadVehicles();
    setStatus('ACE routes selected', `${matches.length} active route shapes matched the ACE program dataset.`, 'success');
  } catch (error) {
    setStatus('ACE route list unavailable', `Could not load ACE routes: ${error.message}`, 'error');
  } finally {
    els.selectAce.disabled = false;
  }
}

function selectAllRoutes() {
  state.allRoutesSelected = true;
  state.selectedRoutes.clear();
  renderRoutePicker();
  applyFilters({ fitMap: true });
  loadVehicles();
}

function selectNoRoutes() {
  state.allRoutesSelected = false;
  state.selectedRoutes.clear();
  renderRoutePicker();
  applyFilters();
  loadVehicles();
}

async function loadVehicles() {
  const requestId = ++state.vehicleRequestId;
  state.vehicleRequest?.abort();
  state.vehicleRequest = null;

  if (!state.apiKey) {
    state.vehicles = [];
    drawVehicles();
    setStatus('API key needed', 'Enter your MTA Bus Time key to load live bus positions.', 'loading');
    return;
  }
  if (!state.allRoutesSelected && !state.selectedRoutes.size) {
    state.vehicles = [];
    drawVehicles();
    return;
  }

  const controller = new AbortController();
  state.vehicleRequest = controller;
  const url = new URL(CONFIG.vehicleUrl);
  url.searchParams.set('key', state.apiKey);
  url.searchParams.set('VehicleMonitoringDetailLevel', 'minimum');
  if (!state.allRoutesSelected && state.selectedRoutes.size === 1) {
    url.searchParams.set('LineRef', [...state.selectedRoutes][0]);
  }

  try {
    const payload = await fetchJson(url, { signal: controller.signal });
    if (requestId !== state.vehicleRequestId) return;
    state.vehicles = extractVehicles(payload);
    updateBusHighlights();
    drawVehicles();
    syncLayers();
    if (state.routes.length || state.stops.length) {
      setStatus('MTA network loaded', 'Routes, stops, and live buses are updating.', 'success');
    }
    els.lastUpdated.textContent = timestampLabel('Live buses updated');
  } catch (error) {
    if (requestId !== state.vehicleRequestId || error.name === 'AbortError') return;
    state.vehicles = [];
    drawVehicles();
    setStatus('Live bus feed unavailable', `${error.message}. Check the key and whether the MTA endpoint allows browser requests.`, 'error');
    els.lastUpdated.textContent = 'Waiting for live bus feed';
  } finally {
    if (requestId === state.vehicleRequestId) state.vehicleRequest = null;
  }
}

// UI events
let routeSearchTimer;
els.search.addEventListener('input', () => {
  window.clearTimeout(routeSearchTimer);
  routeSearchTimer = window.setTimeout(renderRoutePicker, 120);
});
els.busSearch.addEventListener('input', () => {
  updateBusHighlights();
  drawVehicles();
});
els.selectAce.addEventListener('click', selectAceRoutes);
els.selectAllRoutes.addEventListener('click', selectAllRoutes);
els.selectNoRoutes.addEventListener('click', selectNoRoutes);
[els.routes, els.stops, els.vehicles].forEach((checkbox) => checkbox.addEventListener('change', syncLayers));

els.keyForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  state.apiKey = els.apiKey.value.trim();
  if (!state.apiKey) {
    setStatus('API key needed', 'Enter your MTA Bus Time key to load live bus positions.', 'error');
    return;
  }
  els.apiKey.value = '';
  els.clearKey.hidden = false;
  await loadVehicles();
});

els.clearKey.addEventListener('click', () => {
  state.apiKey = '';
  state.vehicleRequest?.abort();
  state.vehicles = [];
  drawVehicles();
  els.clearKey.hidden = true;
  setStatus('API key cleared', 'Enter your MTA Bus Time key to load live bus positions.', 'loading');
});

els.refresh.addEventListener('click', async () => {
  els.refresh.disabled = true;
  try {
    await loadNetworkData();
  } catch {
    // loadNetworkData has already updated the status message.
  }
  await loadVehicles();
  els.refresh.disabled = false;
});

(async function start() {
  try {
    await loadNetworkData();
  } catch {
    // Keep the map shell available if network data is unavailable.
  }
  if (!state.apiKey) {
    setStatus('API key needed', 'Enter your MTA Bus Time key to load live bus positions.', 'loading');
  }
})();

window.setInterval(() => {
  if (state.apiKey) loadVehicles();
}, CONFIG.vehicleRefreshMs);
