import { CONFIG, els, setStatus, timestampLabel } from './js/config.js';
import { createDataService } from './js/data.js';
import { createMapView } from './js/map-view.js';

const state = {
  routes: [],
  stops: [],
  vehicles: [],
  signs: [],
  selectedRoutes: new Set(),
  allRoutesSelected: true,
  routeLines: [],
  routeStyles: new Map(),
  apiKey: '',
  vehicleRequest: null,
  vehicleRequestId: 0,
  signRequest: null
};

const data = createDataService();
let view;

function routeName(record) {
  return String(record.route_short_name || record.route_id || 'Bus').trim();
}
function routeKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

async function loadNetworkData() {
  setStatus('Loading MTA network', 'Fetching active routes and bus stops…');
  const [routeResult, stopResult] = await data.loadNetwork();
  if (routeResult.status === 'fulfilled') state.routes = routeResult.value;
  if (stopResult.status === 'fulfilled') state.stops = stopResult.value;
  if (routeResult.status === 'rejected' && stopResult.status === 'rejected') {
    setStatus('Network data unavailable', 'Could not load routes or stops. Check your connection and retry.', 'error');
    throw routeResult.reason;
  }

  const availableRoutes = new Set(view.sortedRouteNames().map(routeKey));
  state.selectedRoutes = new Set([...state.selectedRoutes].filter((name) => availableRoutes.has(routeKey(name))));
  els.routeCount.textContent = String(new Set(state.routes.map(routeName)).size);
  els.stopCount.textContent = String(view.stopsWithRoutes().length);
  view.renderRoutePicker();
  view.applyFilters();

  const errors = [];
  if (routeResult.status === 'rejected') errors.push('Routes could not be loaded');
  if (stopResult.status === 'rejected') errors.push('Stops could not be loaded');
  if (errors.length) setStatus('Partially loaded', `${errors.join('. ')}.`, 'error');
  else setStatus('MTA network loaded', 'Routes and stops are up to date.', 'success');
  els.lastUpdated.textContent = timestampLabel('Network updated');
}

async function loadVehicles() {
  const requestId = ++state.vehicleRequestId;
  state.vehicleRequest?.abort();
  state.vehicleRequest = null;

  if (!state.apiKey) {
    state.vehicles = [];
    view.drawVehicles();
    setStatus('API key needed', 'Enter your MTA Bus Time key to load live bus positions.', 'loading');
    return;
  }

  const controller = new AbortController();
  state.vehicleRequest = controller;

  try {
    const vehicles = await data.loadVehicles({ apiKey: state.apiKey, signal: controller.signal });
    if (requestId !== state.vehicleRequestId) return;
    state.vehicles = vehicles;
    view.updateBusHighlights();
    view.drawVehicles();
    view.syncLayers();
    if (state.routes.length || state.stops.length) {
      setStatus('MTA network loaded', 'Routes, stops, and live buses are updating.', 'success');
    }
    els.lastUpdated.textContent = timestampLabel('Live buses updated');
  } catch (error) {
    if (requestId !== state.vehicleRequestId || error.name === 'AbortError') return;
    state.vehicles = [];
    view.drawVehicles();
    setStatus('Live bus feed unavailable', `${error.message}. Check the key and whether the MTA endpoint allows browser requests.`, 'error');
    els.lastUpdated.textContent = 'Waiting for live bus feed';
  } finally {
    if (requestId === state.vehicleRequestId) state.vehicleRequest = null;
  }
}

async function handleRouteSelection() {
  view.applyFilters({ fitMap: true });
  await loadVehicles();
}

view = createMapView(state, handleRouteSelection);

function updateStreetSignControl() {
  const width = view.viewportWidthFeet();
  const tooWide = width > CONFIG.streetSignsMaxWidthFeet;
  els.fetchSigns.disabled = Boolean(state.signRequest) || tooWide;
  if (state.signRequest) {
    els.signsStatus.textContent = 'Fetching signs for the current map view…';
  } else if (tooWide) {
    els.signsStatus.textContent = `Zoom in until the map is no more than ${CONFIG.streetSignsMaxWidthFeet} ft wide (currently about ${Math.round(width).toLocaleString()} ft).`;
  } else {
    els.signsStatus.textContent = `Current map width: about ${Math.round(width).toLocaleString()} ft. Fetch signs for this view.`;
  }
}

async function fetchStreetSigns() {
  const width = view.viewportWidthFeet();
  if (width > CONFIG.streetSignsMaxWidthFeet || state.signRequest) {
    updateStreetSignControl();
    return;
  }

  const controller = new AbortController();
  state.signRequest = controller;
  updateStreetSignControl();
  try {
    const signs = await data.loadStreetSigns(viewportBounds(), { signal: controller.signal });
    if (state.signRequest !== controller) return;
    state.signs = signs;
    els.signs.checked = true;
    view.drawSigns();
    view.syncLayers();
    els.signsStatus.textContent = signs.length >= CONFIG.streetSignsLimit
      ? `Showing ${signs.length.toLocaleString()} signs (the API result limit was reached; zoom in for a smaller view).`
      : `${signs.length.toLocaleString()} signs loaded for this view.`;
    els.lastUpdated.textContent = timestampLabel('Street signs loaded');
  } catch (error) {
    if (error.name !== 'AbortError') {
      els.signsStatus.textContent = `Could not load street signs: ${error.message}`;
    }
  } finally {
    if (state.signRequest === controller) state.signRequest = null;
    updateStreetSignControl();
    if (state.signs.length) {
      els.signsStatus.textContent = `${state.signs.length.toLocaleString()} signs loaded. Fetch again to update for the current view.`;
    }
  }
}

function viewportBounds() {
  return map.getBounds();
}

async function selectAceRoutes() {
  els.selectAce.disabled = true;
  try {
    const records = await data.loadAceRoutes();
    const aceNames = new Set(records.map((record) => routeKey(record.route)).filter(Boolean));
    const matches = view.sortedRouteNames().filter((name) => aceNames.has(routeKey(name)));
    if (!matches.length) {
      setStatus('No ACE routes matched', 'The ACE dataset loaded, but no route names matched the active route shapes.', 'error');
      return;
    }
    state.selectedRoutes = new Set(matches);
    state.allRoutesSelected = false;
    els.search.value = '';
    view.renderRoutePicker();
    view.applyFilters({ fitMap: true });
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
  view.renderRoutePicker();
  view.applyFilters({ fitMap: true });
  loadVehicles();
}

function selectNoRoutes() {
  state.allRoutesSelected = false;
  state.selectedRoutes.clear();
  view.renderRoutePicker();
  view.applyFilters();
  loadVehicles();
}

let routeSearchTimer;
els.search.addEventListener('input', () => {
  window.clearTimeout(routeSearchTimer);
  routeSearchTimer = window.setTimeout(() => view.renderRoutePicker(), 120);
});
els.busSearch.addEventListener('input', () => {
  view.updateBusHighlights();
  view.drawVehicles();
});
els.selectAce.addEventListener('click', selectAceRoutes);
els.selectAllRoutes.addEventListener('click', selectAllRoutes);
els.selectNoRoutes.addEventListener('click', selectNoRoutes);
els.fetchSigns.addEventListener('click', fetchStreetSigns);
els.signs.addEventListener('change', view.syncLayers);
[els.routes, els.stops, els.vehicles].forEach((checkbox) => checkbox.addEventListener('change', view.syncLayers));
map.on('moveend zoomend resize', updateStreetSignControl);
updateStreetSignControl();

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
  view.drawVehicles();
  els.clearKey.hidden = true;
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
  if (!state.apiKey) setStatus('API key needed', 'Enter your MTA Bus Time key to load live bus positions.', 'loading');
})();

window.setInterval(() => {
  if (state.apiKey) loadVehicles();
}, CONFIG.vehicleRefreshMs);
