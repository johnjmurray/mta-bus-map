import { layers, map } from './config.js';

// Keep marker instances cached while they are outside the viewport so a pan or
// zoom can restore them without waiting for the next MTA feed refresh.
const knownVehicles = new Set();
let filtering = false;
let filterScheduled = false;

function scheduleViewportFilter() {
  if (filterScheduled) return;
  filterScheduled = true;
  requestAnimationFrame(() => {
    filterScheduled = false;
    filterVehiclesToViewport();
  });
}

function filterVehiclesToViewport() {
  if (filtering) return;
  filtering = true;
  try {
    const bounds = map.getBounds();
    let visibleCount = 0;
    for (const marker of knownVehicles) {
      const visible = bounds.contains(marker.getLatLng());
      const isRendered = layers.vehicles.hasLayer(marker);
      if (visible) {
        visibleCount += 1;
        if (!isRendered) layers.vehicles.addLayer(marker);
      } else if (isRendered) {
        layers.vehicles.removeLayer(marker);
      }
    }
    const count = document.querySelector('#vehicle-count');
    if (count) count.textContent = String(visibleCount);
  } finally {
    filtering = false;
  }
}

layers.vehicles.on('layeradd', ({ layer }) => {
  if (!(layer instanceof L.Marker)) return;
  knownVehicles.add(layer);
  scheduleViewportFilter();
});

layers.vehicles.on('layerremove', ({ layer }) => {
  if (!filtering && layer instanceof L.Marker) knownVehicles.delete(layer);
});

map.on('moveend zoomend', scheduleViewportFilter);
scheduleViewportFilter();
