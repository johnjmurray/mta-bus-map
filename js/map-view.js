import {
  AGENCY_COLORS, els, escapeHtml, layers, map, ROUTE_PREFIX_PATTERN, VEHICLE_ROUTE_COLORS
} from './config.js';

export {
  AGENCY_COLORS, els, escapeHtml, layers, map, ROUTE_PREFIX_PATTERN, VEHICLE_ROUTE_COLORS
} from './config.js';

import { projectLngLatToStatePlane } from './data.js';

export function createMapView(state, onRouteSelectionChange) {
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

  function normalizeVehicleName(raw) {
    const value = String(raw ?? '').trim().replace(/^MTA\s+/i, '');
    if (!value) return { number: '—', agency: 'Unknown' };
    const number = value.match(/\d{3,5}/)?.[0] || '—';
    const agencyMatch = value.match(/(?:^|[\s_-])(?:MTA\s+)?(NYCT|MTABC)(?=[\s_-]|$)/i)?.[1]?.toUpperCase();
    const routePrefix = value.match(ROUTE_PREFIX_PATTERN)?.[1]?.toUpperCase();
    return { number, agency: agencyMatch || routePrefix || 'Unknown' };
  }

  function sortedRouteNames() {
    return [...new Set(state.routes.map(routeName))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  function ensureRouteStyle(name) {
    const key = routeKey(name);
    if (!state.routeStyles.has(key)) {
      const record = state.routes.find((item) => routeKey(routeName(item)) === key);
      const color = String(record?.route_color || '').replace(/^#/, '');
      state.routeStyles.set(key, {
        color: /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : '#2768d8',
        opacity: 0.8
      });
    }
    return state.routeStyles.get(key);
  }

  function parseVertices(input) {
    if (!input) return null;
    if (typeof input === 'object') return input;
    const text = String(input).trim();
    try { return JSON.parse(text); } catch {
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

  function renderRouteStyles() {
    els.routeStyles.replaceChildren();
    if (!state.selectedRoutes.size) {
      const note = document.createElement('p');
      note.className = 'route-style-empty';
      note.textContent = state.allRoutesSelected ? 'Select specific routes to customize line color and opacity.' : 'No routes selected.';
      els.routeStyles.append(note);
      return;
    }
    for (const route of [...state.selectedRoutes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
      const style = ensureRouteStyle(route);
      const row = document.createElement('div'); row.className = 'route-style-row';
      const name = document.createElement('strong'); name.textContent = route;
      const colorLabel = document.createElement('label'); colorLabel.textContent = 'Color';
      const colorInput = document.createElement('input'); colorInput.type = 'color'; colorInput.value = style.color;
      colorInput.setAttribute('aria-label', `${route} line color`);
      colorInput.addEventListener('input', () => { style.color = colorInput.value; drawRoutes(); });
      colorLabel.append(colorInput);
      const opacityLabel = document.createElement('label'); opacityLabel.className = 'opacity-control';
      const opacityText = document.createElement('span'); opacityText.textContent = `Opacity ${Math.round(style.opacity * 100)}%`;
      const opacityInput = document.createElement('input'); opacityInput.type = 'range'; opacityInput.min = '10'; opacityInput.max = '100'; opacityInput.value = String(Math.round(style.opacity * 100));
      opacityInput.setAttribute('aria-label', `${route} line opacity`);
      opacityInput.addEventListener('input', () => { style.opacity = Number(opacityInput.value) / 100; opacityText.textContent = `Opacity ${opacityInput.value}%`; drawRoutes(); });
      opacityLabel.append(opacityText, opacityInput); row.append(name, colorLabel, opacityLabel); els.routeStyles.append(row);
    }
  }

  function renderRoutePicker() {
    const term = els.search.value.trim().toLowerCase();
    const names = sortedRouteNames().filter((name) => {
      const longNames = state.routes.filter((route) => routeKey(routeName(route)) === routeKey(name)).map((route) => route.route_long_name || '').join(' ');
      return `${name} ${longNames}`.toLowerCase().includes(term);
    });
    els.routeList.replaceChildren();
    for (const name of names) {
      const label = document.createElement('label'); label.className = 'route-option';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = name;
      checkbox.checked = state.allRoutesSelected || state.selectedRoutes.has(name);
      checkbox.addEventListener('change', () => {
        if (state.allRoutesSelected) { state.selectedRoutes = new Set(sortedRouteNames()); state.allRoutesSelected = false; }
        if (checkbox.checked) state.selectedRoutes.add(name); else state.selectedRoutes.delete(name);
        renderRoutePicker(); onRouteSelectionChange();
      });
      const text = document.createElement('span'); text.textContent = name; label.append(checkbox, text); els.routeList.append(label);
    }
    renderRouteStyles();
  }

  function drawRoutes() {
    layers.routes.clearLayers(); state.routeLines = [];
    for (const route of state.routes) {
      const name = routeName(route); if (!state.allRoutesSelected && !state.selectedRoutes.has(name)) continue;
      const lines = normalizeLines(geometryCoordinates(route)); if (!lines.length) continue;
      const style = ensureRouteStyle(name);
      const group = L.featureGroup(lines.map((latlngs) => L.polyline(latlngs, { color: style.color, weight: state.allRoutesSelected ? 3 : 5, opacity: style.opacity, lineCap: 'round', lineJoin: 'round' })));
      group.bindPopup(`<strong>${escapeHtml(name)}</strong><br>${escapeHtml(route.route_long_name || 'MTA bus route')}`);
      group.addTo(layers.routes); state.routeLines.push(group);
    }
    if (els.routes.checked && map.hasLayer(layers.routes)) layers.routes.bringToBack();
  }

  function stopLatLng(stop) {
    const latitude = Number(stop.latitude ?? stop.georeference?.coordinates?.[1]);
    const longitude = Number(stop.longitude ?? stop.georeference?.coordinates?.[0]);
    return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180 && latitude !== 0 && longitude !== 0 ? [latitude, longitude] : null;
  }

  function stopsWithRoutes() {
    const grouped = new Map();
    for (const stop of state.stops) {
      const latlng = stopLatLng(stop); if (!latlng) continue;
      const key = stop.stop_id ? `id:${stop.stop_id}` : `loc:${latlng.join(',')}:${stop.stop_name || ''}`;
      let entry = grouped.get(key); if (!entry) { entry = { ...stop, latlng, servedRoutes: new Set() }; grouped.set(key, entry); }
      const route = String(stop.route_short_name || stop.route_id || '').trim(); if (route) entry.servedRoutes.add(route);
    }
    return [...grouped.values()];
  }

  function drawStops() {
    layers.stops.clearLayers();
    for (const stop of stopsWithRoutes()) {
      const routes = [...stop.servedRoutes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const routeText = routes.length ? routes.map(escapeHtml).join(', ') : 'Not specified';
      const details = `<strong>${escapeHtml(stop.stop_name || 'Bus stop')}</strong><br>Stop ${escapeHtml(stop.stop_id || '—')}<br>Routes: ${routeText}`;
      L.circleMarker(stop.latlng, { radius: 3.2, color: '#ffffff', weight: 1.2, fillColor: '#25364a', fillOpacity: 0.9 }).bindTooltip(details, { direction: 'top', opacity: 0.96 }).bindPopup(details).addTo(layers.stops);
    }
  }

  function signText(value) { return String(value ?? '').trim() || '—'; }
  function signTooltip(sign) {
    return [
      `<strong>${escapeHtml(signText(sign.sign_description))}</strong><br>${escapeHtml(signText(sign.sign_notes))} | ${escapeHtml(signText(sign.sign_code))}`,
      `${escapeHtml(signText(sign.side_of_street))} side of ${escapeHtml(signText(sign.on_street))} (${escapeHtml(signText(sign.from_street))} -> ${escapeHtml(signText(sign.to_street))})`,
      `${escapeHtml(signText(sign.distance_from_intersection))} ft from ${escapeHtml(signText(sign.from_street))}`,
      `${escapeHtml(signText(sign.order_completed_on_date))} | ${escapeHtml(signText(sign.record_type))} | ${escapeHtml(signText(sign.order_number))}`
    ].join('<br>');
  }

  function renderSignSidebar() {
    const sidebar = document.querySelector('#sign-sidebar');
    const summary = document.querySelector('#sign-sidebar-summary');
    const list = document.querySelector('#sign-sidebar-list');
    if (!sidebar || !summary || !list) return;
    list.replaceChildren();
    const signs = [...state.signs];
    if (!signs.length) { sidebar.hidden = true; summary.textContent = ''; return; }

    sidebar.hidden = false;
    summary.textContent = `${signs.length.toLocaleString()} sign${signs.length === 1 ? '' : 's'} returned`;
    const groups = new Map();
    for (const sign of signs) {
      const order = signText(sign.order_number);
      if (!groups.has(order)) groups.set(order, []);
      groups.get(order).push(sign);
    }
    const numericSort = (a, b) => {
      const an = Number(a), bn = Number(b);
      if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return bn - an;
      if (Number.isFinite(an) !== Number.isFinite(bn)) return Number.isFinite(an) ? -1 : 1;
      return b.localeCompare(a, undefined, { numeric: true });
    };

    for (const order of [...groups.keys()].sort(numericSort)) {
      const section = document.createElement('section'); section.className = 'sign-order-group';
      const heading = document.createElement('h3'); heading.textContent = `Order ${order}`; section.append(heading);
      for (const sign of groups.get(order)) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'sign-list-item';
        button.innerHTML = `<strong>${escapeHtml(signText(sign.sign_description))}</strong><span>${escapeHtml(signText(sign.sign_code))} · ${escapeHtml(signText(sign.on_street))}</span>`;
        button.addEventListener('click', () => {
          map.flyTo([sign.latitude, sign.longitude], Math.max(map.getZoom(), 19), { duration: 0.35 });
          const marker = state.signMarkers?.get(sign);
          if (marker) marker.openPopup();
        });
        section.append(button);
      }
      list.append(section);
    }
  }

  function drawSigns() {
    layers.signs.clearLayers();
    state.signMarkers = new Map();
    for (const sign of state.signs) {
      const details = signTooltip(sign);
      const marker = L.circleMarker([sign.latitude, sign.longitude], { radius: 5, color: '#fff2c6', weight: 1, fillColor: '#f0a52b', fillOpacity: 0.95 })
        .bindTooltip(details, { direction: 'top', sticky: true, opacity: 0.96 })
        .bindPopup(details)
        .addTo(layers.signs);
      state.signMarkers.set(sign, marker);
    }
    renderSignSidebar();
  }

  function viewportWidthFeet() {
    const bounds = map.getBounds();
    const corners = [bounds.getNorthWest(), bounds.getNorthEast(), bounds.getSouthWest(), bounds.getSouthEast()].map(({ lat, lng }) => projectLngLatToStatePlane(lng, lat));
    const xs = corners.map(([x]) => x);
    return Math.max(...xs) - Math.min(...xs);
  }

  function buildBusIcon(vehicle) {
    const routeValue = vehicle.route || vehicle.vehicle || 'Bus';
    const display = normalizeVehicleName(vehicle.vehicle || vehicle.route || 'Bus');
    const normalizedRoute = String(routeValue ?? '').replace(/^(?:MTA\s+)?(?:NYCT|MTABC)[\s_-]*/i, '').trim();
    const prefix = normalizedRoute.match(ROUTE_PREFIX_PATTERN)?.[1]?.toUpperCase() || vehicleRouteName(routeValue).match(ROUTE_PREFIX_PATTERN)?.[1]?.toUpperCase();
    const routeRecord = state.routes.find((record) => routeKey(routeName(record)) === routeKey(prefix || ''));
    const requestedColor = routeRecord?.route_color || VEHICLE_ROUTE_COLORS[prefix] || VEHICLE_ROUTE_COLORS.DEFAULT;
    const fillColor = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(requestedColor)) ? String(requestedColor) : (VEHICLE_ROUTE_COLORS[prefix] || VEHICLE_ROUTE_COLORS.DEFAULT);
    const borderColor = display.agency === 'MTABC' ? AGENCY_COLORS.MTABC : display.agency === 'NYCT' ? AGENCY_COLORS.NYCT : AGENCY_COLORS.DEFAULT;
    const highlighted = Boolean(vehicle.searchMatch);
    const html = `<div class="bus-marker ${highlighted ? 'highlighted' : ''}" style="--bus-fill:${fillColor};--bus-border:${borderColor}"></div>`;
    return L.divIcon({ className: 'bus-marker-wrapper', html, iconSize: [20, 20], iconAnchor: [10, 10], popupAnchor: [0, -10] });
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

  function vehicleMatchesSelectedRoutes(vehicle) { return true; }

  function drawVehicles() {
    layers.vehicles.clearLayers(); let count = 0;
    for (const vehicle of state.vehicles) {
      if (!vehicleMatchesSelectedRoutes(vehicle)) continue;
      L.marker([vehicle.latitude, vehicle.longitude], { icon: buildBusIcon(vehicle) }).bindPopup(buildVehiclePopup(vehicle)).bindTooltip(formatVehicleTooltip(vehicle), { direction: 'top', offset: [0, -6], opacity: 0.96 }).addTo(layers.vehicles); count++;
    }
    els.vehicleCount.textContent = String(count);
  }

  function syncLayers() {
    for (const [layer, checkbox] of [[layers.routes, els.routes], [layers.stops, els.stops], [layers.vehicles, els.vehicles], [layers.signs, els.signs]]) {
      if (checkbox.checked && !map.hasLayer(layer)) map.addLayer(layer);
      else if (!checkbox.checked && map.hasLayer(layer)) map.removeLayer(layer);
    }
  }

  function applyFilters({ fitMap = false } = {}) {
    drawRoutes(); drawStops(); drawVehicles(); drawSigns(); syncLayers();
    if (state.allRoutesSelected) els.mapHeading.textContent = 'New York City';
    else if (state.selectedRoutes.size) {
      const selectedNames = [...state.selectedRoutes];
      if (fitMap && state.routeLines.length) { const lines = state.routeLines.flatMap((group) => group.getLayers()); const bounds = L.featureGroup(lines).getBounds(); if (bounds.isValid()) map.fitBounds(bounds, { padding: [35, 35], maxZoom: 14 }); }
      els.mapHeading.textContent = selectedNames.length <= 3 ? selectedNames.join(', ') : `${selectedNames.length} routes selected`;
    } else els.mapHeading.textContent = 'No routes selected';
    renderRouteStyles();
  }

  function updateBusHighlights() {
    const term = els.busSearch.value.trim().toLowerCase();
    for (const vehicle of state.vehicles) { const number = normalizeVehicleName(vehicle.vehicle || vehicle.route || '').number; vehicle.searchMatch = Boolean(term) && number.toLowerCase() === term; }
  }

  return { applyFilters, drawVehicles, drawSigns, renderRoutePicker, sortedRouteNames, stopsWithRoutes, syncLayers, updateBusHighlights, viewportWidthFeet };
}
