import { map } from './js/config.js';

const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const CARTO_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const CARTO_ATTRIBUTION = '&copy; <a href="https://carto.com/attributions">CARTO</a>, &copy; OpenStreetMap contributors';

// Draw bus divIcons explicitly: an unstyled divIcon is transparent in Leaflet.
const style = document.createElement('style');
style.textContent = `
  .bus-marker-wrapper { border: 0 !important; background: transparent !important; }
  .bus-marker { display: block; width: 18px; height: 18px; box-sizing: border-box; border: 3px solid var(--bus-border, #111); border-radius: 50%; background: var(--bus-fill, #f7f7f7) !important; opacity: 1 !important; box-shadow: 0 1px 5px #000b; }
  .bus-marker.highlighted { outline: 3px solid #ffca28; outline-offset: 2px; }
  .route-style-row > label:not(.opacity-control) { display: block; width: 26px; height: 26px; overflow: hidden; color: transparent; font-size: 0; cursor: pointer; }
  .route-style-row input[type="color"] { display: block; width: 26px; height: 26px; min-width: 26px; padding: 2px; border: 1px solid #596575; border-radius: 3px; background: #202832; cursor: pointer; }
  .basemap-control { display: grid; gap: 8px; padding: 10px 0 2px; }
  .basemap-control label { color: #d7dce2; font-size: 11px; font-weight: 700; }
  .basemap-control select, .basemap-control input { width: 100%; min-height: 34px; padding: 0 9px; border: 1px solid #363e48; color: #e6e9ed; background: #0e1217; }
  .basemap-control p { margin: 0; color: #929ba6; font-size: 10px; line-height: 1.5; }
`;
document.head.append(style);

// Associate the visible route-color label with its native color input. This also
// keeps the picker usable when a browser doesn't make clicking a bare label work.
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
      <option value="carto">CARTO grayscale</option>
    </select>
    <label for="carto-api-key">CARTO API key <span>(optional)</span></label>
    <input id="carto-api-key" type="password" placeholder="Enter CARTO API key" autocomplete="off" spellcheck="false">
    <p id="basemap-status" aria-live="polite">OpenStreetMap is active. CARTO basemaps can also be used without a key.</p>
  `;
  drawer.append(section);

  let tileLayer = L.tileLayer(OSM_URL, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(map);
  const selector = section.querySelector('#basemap-selector');
  const keyInput = section.querySelector('#carto-api-key');
  const status = section.querySelector('#basemap-status');
  function updateBasemap() {
    const useCarto = selector.value === 'carto';
    if (tileLayer) map.removeLayer(tileLayer);
    const url = useCarto ? CARTO_URL : OSM_URL;
    const key = keyInput.value.trim();
    const keyedUrl = useCarto && key ? `${url}?api_key=${encodeURIComponent(key)}` : url;
    tileLayer = L.tileLayer(keyedUrl, {
      maxZoom: 19,
      attribution: useCarto ? CARTO_ATTRIBUTION : OSM_ATTRIBUTION
    }).addTo(map);
    status.textContent = useCarto
      ? (key ? 'CARTO grayscale basemap active. The API key is kept only for this visit.' : 'CARTO grayscale basemap active. CARTO tiles work without a key; enter one if your account requires it.')
      : 'OpenStreetMap is active.';
    tileLayer.on('tileerror', () => {
      status.textContent = useCarto
        ? 'CARTO tiles could not be loaded. Check your connection and, if required, your API key.'
        : 'OpenStreetMap tiles could not be loaded. Check your connection.';
    });
  }
  selector.addEventListener('change', updateBasemap);
  keyInput.addEventListener('change', () => { if (selector.value === 'carto') updateBasemap(); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupBasemapControl, { once: true });
else setupBasemapControl();
