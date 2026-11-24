import { map } from './config.js';
import './viewport-vehicles.js';

const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const CARTO_ATTRIBUTION = '&copy; <a href="https://carto.com/attributions">CARTO</a>, &copy; OpenStreetMap contributors';
const CARTO_STYLES = {
  positron: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  voyager: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
  'dark-matter': 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
};

const style = document.createElement('style');
style.textContent = `
  .bus-marker-wrapper { border: 0 !important; background: transparent !important; }
  .bus-marker { display: block; width: 18px; height: 18px; box-sizing: border-box; border: 3px solid var(--bus-border, #111); border-radius: 50%; background: var(--bus-fill, #f7f7f7) !important; }
  .bus-marker.highlighted { outline: 3px solid #ffca28; outline-offset: 2px; }
  .route-style-row > label:not(.opacity-control) { display: block; width: 26px; height: 26px; overflow: hidden; color: transparent; font-size: 0; cursor: pointer; }
  .route-style-row input[type="color"] { display: block; width: 26px; height: 26px; min-width: 26px; padding: 2px; border: 1px solid #596575; border-radius: 3px; background: #202832; cursor: pointer; }
  .basemap-control { display: grid; gap: 8px; padding: 10px 0 2px; }
  .basemap-control label { color: #d7dce2; font-size: 11px; font-weight: 700; }
  .basemap-control select, .basemap-control input { width: 100%; min-height: 34px; padding: 0 9px; border: 1px solid #363e48; color: #e6e9ed; background: #0e1217; }
  .basemap-control p { margin: 0; color: #929ba6; font-size: 10px; line-height: 1.5; }
`;
document.head.append(style);

function fixRouteColorLabels() {
  document.querySelectorAll('#route-styles .route-style-row').forEach((row, index) => {
    const label = [...row.querySelectorAll('label')].find((item) => item.textContent.trim() === 'Color');
    const input = row.querySelector('input[type="color"]');
    if (!label || !input) return;
    if (!input.id) input.id = `route-color-${index}`;
    label.htmlFor = input.id;
    label.title = `${row.querySelector('strong')?.textContent || 'Route'} line color`;
  });
}
const routeStyles = document.querySelector('#route-styles');
if (routeStyles) new MutationObserver(fixRouteColorLabels).observe(routeStyles, { childList: true, subtree: true });
fixRouteColorLabels();

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(script);
  });
}

function ensureVectorMapSupport() {
  if (window.L?.maplibreGL) return Promise.resolve();
  if (ensureVectorMapSupport.promise) return ensureVectorMapSupport.promise;
  const maplibreCss = document.createElement('link');
  maplibreCss.rel = 'stylesheet';
  maplibreCss.href = 'https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css';
  document.head.append(maplibreCss);
  ensureVectorMapSupport.promise = loadScript('https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js')
    .then(() => loadScript('https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.3/leaflet-maplibre-gl.js'))
    .then(() => {
      if (!window.L?.maplibreGL) throw new Error('The Leaflet/MapLibre integration did not initialize.');
    });
  return ensureVectorMapSupport.promise;
}

function setupBasemapControl() {
  const drawer = document.querySelector('#map-controls-drawer');
  if (!drawer || document.querySelector('#basemap-selector')) return;
  const section = document.createElement('section');
  section.className = 'control-section basemap-control';
  section.setAttribute('aria-labelledby', 'basemap-heading');
  section.innerHTML = `
    <h2 class="section-title" id="basemap-heading">Basemap</h2>
    <label for="basemap-selector">Choose a map style</label>
    <select id="basemap-selector">
      <option value="osm">OpenStreetMap</option>
      <option value="positron">CARTO Positron (vector)</option>
      <option value="voyager">CARTO Voyager (vector)</option>
      <option value="dark-matter">CARTO Dark Matter (vector)</option>
    </select>
    <label for="carto-api-key">CARTO basemaps API key <span>(required for CARTO)</span></label>
    <input id="carto-api-key" type="password" placeholder="Enter CARTO basemaps API key" autocomplete="off" spellcheck="false">
    <p id="basemap-status" aria-live="polite">OpenStreetMap is active. CARTO vector styles require a basemaps API key.</p>
  `;
  drawer.append(section);

  let basemapLayer;
  map.eachLayer((layer) => {
    if (!basemapLayer && layer instanceof L.TileLayer) basemapLayer = layer;
  });
  if (!basemapLayer) basemapLayer = L.tileLayer(OSM_URL, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(map);

  const selector = section.querySelector('#basemap-selector');
  const keyInput = section.querySelector('#carto-api-key');
  const status = section.querySelector('#basemap-status');
  const attributionNote = document.querySelector('.map-attribution-note');
  let requestedStyle = 0;

  function updateAttribution(useCarto) {
    if (attributionNote) attributionNote.innerHTML = useCarto ? CARTO_ATTRIBUTION : `Map data ${OSM_ATTRIBUTION}`;
  }

  async function updateBasemap() {
    const styleName = selector.value;
    const isCarto = styleName !== 'osm';
    const requestId = ++requestedStyle;
    const key = keyInput.value.trim();
    if (isCarto && !key) {
      status.textContent = 'Enter a CARTO basemaps API key to load this vector style. The current basemap is unchanged.';
      return;
    }

    if (!isCarto) {
      if (basemapLayer && map.hasLayer(basemapLayer)) map.removeLayer(basemapLayer);
      basemapLayer = L.tileLayer(OSM_URL, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(map);
      status.textContent = 'OpenStreetMap is active.';
      updateAttribution(false);
      return;
    }

    status.textContent = 'Loading CARTO vector basemap…';
    try {
      await ensureVectorMapSupport();
      if (requestId !== requestedStyle) return;
      const styleUrl = new URL(CARTO_STYLES[styleName]);
      styleUrl.searchParams.set('key', key);
      const vectorLayer = L.maplibreGL({
        style: styleUrl.toString(),
        attribution: CARTO_ATTRIBUTION,
        maxZoom: 22
      });
      if (basemapLayer && map.hasLayer(basemapLayer)) map.removeLayer(basemapLayer);
      basemapLayer = vectorLayer.addTo(map);
      status.textContent = `CARTO ${styleName} vector basemap active. The API key is kept only for this visit.`;
      updateAttribution(true);
      vectorLayer.on('error', () => {
        if (requestId === requestedStyle) status.textContent = 'CARTO vector tiles could not be loaded. Check the API key and connection.';
      });
    } catch (error) {
      if (requestId === requestedStyle) status.textContent = `CARTO vector basemap failed to load: ${error.message}`;
    }
  }

  selector.addEventListener('change', updateBasemap);
  keyInput.addEventListener('change', () => { if (selector.value !== 'osm') updateBasemap(); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupBasemapControl, { once: true });
else setupBasemapControl();
