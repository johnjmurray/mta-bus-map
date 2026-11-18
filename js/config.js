export const CONFIG = {
  routesUrl: 'https://data.ny.gov/resource/bzwk-3hb4.json',
  stopsUrl: 'https://data.ny.gov/resource/2ucp-7wg5.json',
  aceUrl: 'https://data.ny.gov/resource/ki2b-sg5y.json',
  streetSignsUrl: 'https://data.cityofnewyork.us/resource/qt6m-xctn.json',
  streetSignsLimit: 5000,
  streetSignsMaxWidthFeet: 1000,
  vehicleUrl: 'https://bustime-classic.mta.info/api/siri/vehicle-monitoring.json',
  vehicleRefreshMs: 300_000,
  requestTimeoutMs: 20_000,
  mapCenter: [40.7128, -73.95],
  mapZoom: 11
};

export const VEHICLE_ROUTE_COLORS = {
  M: '#2d8cff', Q: '#ff8a3d', BX: '#7a5cff', B: '#3ecf8e', S: '#e86f6f',
  QM: '#ffb703', BXM: '#6c63ff', X: '#f15bb5', SIM: '#7dd3fc', DEFAULT: '#f7f7f7'
};
export const AGENCY_COLORS = { NYCT: '#111111', MTABC: '#ffffff', DEFAULT: '#dfe6ee' };
export const ROUTE_PREFIX_PATTERN = /^(BXM|QM|SIM|BX|M|Q|B|S|X)(?=\d|\s|_|-|$)/i;

export const els = {
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
  signs: document.querySelector('#toggle-signs'),
  fetchSigns: document.querySelector('#fetch-signs'),
  signsStatus: document.querySelector('#signs-status'),
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

export const map = L.map('map', { zoomControl: false, preferCanvas: true })
  .setView(CONFIG.mapCenter, CONFIG.mapZoom);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

export const layers = {
  routes: L.featureGroup().addTo(map),
  stops: L.layerGroup().addTo(map),
  vehicles: L.layerGroup().addTo(map),
  signs: L.layerGroup()
};

export function setStatus(title, message, kind = 'loading') {
  els.statusTitle.textContent = title;
  els.statusMessage.textContent = message;
  els.statusDot.className = `status-dot ${kind}`;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

export function timestampLabel(prefix) {
  return `${prefix} ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}
