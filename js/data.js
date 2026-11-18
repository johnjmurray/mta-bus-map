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

export function createDataService() {
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

  async function loadStreetSigns(bounds, { signal } = {}) {
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
    const query = `SELECT ${fields.map((field) => `\`${field}\``).join(', ')} ` +
      `WHERE CAST(\`sign_x_coord\` AS number) BETWEEN ${minX} AND ${maxX} ` +
      `AND CAST(\`sign_y_coord\` AS number) BETWEEN ${minY} AND ${maxY} LIMIT ${CONFIG.streetSignsLimit}`;
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
