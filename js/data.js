import { CONFIG } from './config.js';

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

  return { loadNetwork, loadAceRoutes, loadVehicles };
}
