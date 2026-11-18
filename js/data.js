import { CONFIG } from './config.js';

const STATE_PLANE_CRS = 'EPSG:2263';
const STATE_PLANE_DEFINITION = '+proj=lcc +lat_1=40.66666666666666 +lat_2=41.03333333333333 +lat_0=40.16666666666666 +lon_0=-74 +x_0=300000.0000000001 +y_0=0 +datum=NAD83 +units=us-ft +no_defs';

function projectCoordinates(from, to, coordinates) {
  const proj4 = window.proj4;
  if (!proj4) throw new Error('The coordinate conversion library could not be loaded.');
  if (!proj4.defs(STATE_PLANE_CRS)) proj4.defs(STATE_PLANE_CRS, STATE_PLANE_DEFINITION);
  return proj4(from, to, coordinates);
}

export function projectLngLatToStatePlane(longitude, latitude) {
  return projectCoordinates('EPSG:4326', STATE_PLANE_CRS, [longitude, latitude]);
}

function projectStatePlaneToLngLat(x, y) {
  return projectCoordinates(STATE_PLANE_CRS, 'EPSG:4326', [x, y]);
}

export function requestUrl(base, fields, where) {
  const query = `SELECT ${fields.map((field) => `\`${field}\``).join(', ')} WHERE ${where} LIMIT 50000`;
  const url = new URL(base);
  url.searchParams.set('$query', query);
  return url;
}

export async function fetchJson(url, { signal, timeoutMs = CONFIG.requestTimeoutMs } = {}) {
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

function findValue(object, names) {
  for (const name of names) {
    if (object?.[name] !== undefined && object[name] !== null) return object[name];
  }
  return undefined;
}

export function extractVehicles(payload) {
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

function ensureHistoricalSignControls() {
  const control = document.querySelector('.sign-control');
  if (!control || document.querySelector('#include-historical-signs')) return;

  const options = document.createElement('div');
  options.className = 'historical-sign-options';
  options.style.cssText = 'display:grid;gap:8px;margin:0 0 10px;color:#d7dce2;font-size:10px;';

  const label = document.createElement('label');
  label.style.cssText = 'display:flex;align-items:center;gap:7px;cursor:pointer;';
  const checkbox = document.createElement('input');
  checkbox.id = 'include-historical-signs';
  checkbox.type = 'checkbox';
  checkbox.setAttribute('aria-controls', 'historical-sign-date');
  const labelText = document.createElement('span');
  labelText.textContent = 'Include HISTORICAL signs';
  label.append(checkbox, labelText);

  const dateLabel = document.createElement('label');
  dateLabel.htmlFor = 'historical-sign-date';
  dateLabel.textContent = 'Completed on or after';
  dateLabel.style.cssText = 'display:grid;gap:4px;color:#929ba6;';
  const date = document.createElement('input');
  date.id = 'historical-sign-date';
  date.type = 'date';
  const defaultDate = new Date();
  defaultDate.setFullYear(defaultDate.getFullYear() - 1);
  date.value = defaultDate.toISOString().slice(0, 10);
  date.disabled = true;
  date.style.cssText = 'width:100%;height:32px;padding:0 8px;border:1px solid #363e48;color:#e6e9ed;background:#0e1217;';
  dateLabel.append(date);
  checkbox.addEventListener('change', () => { date.disabled = !checkbox.checked; });

  options.append(label, dateLabel);
  const button = control.querySelector('#fetch-signs');
  if (button) control.insertBefore(options, button);
  else control.prepend(options);
}

export function createDataService() {
  // The maximum viewport width is shared with the fetch button's map-view validation.
  CONFIG.streetSignsMaxWidthFeet = 1500;
  ensureHistoricalSignControls();

  async function loadNetwork() {
    const routeFields = [
      'valid_from', 'valid_to', 'in_effect', 'route_id', 'route_short_name', 'route_long_name',
      'route_description', 'trip_type', 'route_type', 'bundle', 'route_color', 'direction_id', 'geometry', 'vertices'
    ];
    const stopFields = [
      'valid_from', 'valid_to', 'in_effect', 'route_id', 'route_short_name', 'route_long_name',
      'route_description', 'route_color', 'stop_id', 'stop_name', 'direction_id', 'latitude',
      'longitude', 'georeference'
    ];
    return Promise.allSettled([
      fetchJson(requestUrl(CONFIG.routesUrl, routeFields, 'caseless_one_of(`in_effect`, "true") AND `trip_type` IN ("1","14")')),
      fetchJson(requestUrl(CONFIG.stopsUrl, stopFields, 'caseless_one_of(`in_effect`, "true")'))
    ]);
  }

  async function loadAceRoutes() {
    const url = new URL(CONFIG.aceUrl);
    url.searchParams.set('$query', 'SELECT `route`, `program`, `implementation_date` WHERE caseless_one_of(`program`, "ACE") LIMIT 50000');
    return fetchJson(url);
  }

  async function loadVehicles({ apiKey, selectedRoute, signal }) {
    const url = new URL(CONFIG.vehicleUrl);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('VehicleMonitoringDetailLevel', 'minimum');
    if (selectedRoute) url.searchParams.set('LineRef', selectedRoute);
    return extractVehicles(await fetchJson(url, { signal }));
  }

  async function loadStreetSigns(bounds, { signal, includeHistorical, historicalSince } = {}) {
    const corners = [
      bounds.getNorthWest(), bounds.getNorthEast(), bounds.getSouthWest(), bounds.getSouthEast()
    ].map(({ lat, lng }) => projectLngLatToStatePlane(lng, lat));
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    const minX = Math.floor(Math.min(...xs));
    const maxX = Math.ceil(Math.max(...xs));
    const minY = Math.floor(Math.min(...ys));
    const maxY = Math.ceil(Math.max(...ys));
    const fields = [
      'order_number', 'record_type', 'order_type', 'borough', 'on_street', 'from_street',
      'side_of_street', 'order_completed_on_date', 'sign_code', 'sign_description', 'sign_size',
      'sign_location', 'distance_from_intersection', 'arrow_direction', 'sheeting_type', 'support',
      'sign_x_coord', 'sign_y_coord'
    ];

    const checkbox = document.querySelector('#include-historical-signs');
    const dateInput = document.querySelector('#historical-sign-date');
    const wantHistorical = includeHistorical ?? Boolean(checkbox?.checked);
    const since = historicalSince ?? dateInput?.value;
    let recordFilter = '`record_type` = "Current"';
    if (wantHistorical) {
      if (!since || !/^\d{4}-\d{2}-\d{2}$/.test(since) || Number.isNaN(Date.parse(`${since}T00:00:00`))) {
        throw new Error('Choose a valid date for historical signs.');
      }
      recordFilter = `(${recordFilter} OR (\`record_type\` = "Historical" AND \`order_completed_on_date\` >= "${since}T00:00:00"))`;
    }

    const query = `SELECT ${fields.map((field) => `\`${field}\``).join(', ')} ` +
      `WHERE ${recordFilter} ` +
      `AND \`sign_x_coord\`::number BETWEEN ${minX} AND ${maxX} ` +
      `AND \`sign_y_coord\`::number BETWEEN ${minY} AND ${maxY} LIMIT ${CONFIG.streetSignsLimit}`;
    const url = new URL(CONFIG.streetSignsUrl);
    url.searchParams.set('$query', query);
    const rows = await fetchJson(url, { signal });

    return rows.map((row) => {
      const x = Number(row.sign_x_coord);
      const y = Number(row.sign_y_coord);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      const [longitude, latitude] = projectStatePlaneToLngLat(x, y);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
      return { ...row, latitude, longitude };
    }).filter(Boolean);
  }

  return { loadNetwork, loadAceRoutes, loadVehicles, loadStreetSigns };
}
