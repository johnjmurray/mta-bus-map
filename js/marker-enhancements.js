// Apply marker-specific presentation before the application creates any layers.
(function enhanceLeafletMarkers() {
  if (!window.L?.circleMarker) return;

  const originalCircleMarker = L.circleMarker;
  const BUS_STOP_FILL = '#25364a';
  const DOT_SIGN_FILL = '#f0a52b';

  function colorForSignCode(code) {
    const letter = String(code || '').trim().match(/[A-Za-z]/)?.[0]?.toUpperCase();
    if (!letter) return '#697586';
    // Give each initial a stable, distinguishable hue; the code itself remains in the popup.
    const hue = ((letter.charCodeAt(0) - 65) * 137.508) % 360;
    return `hsl(${hue} 72% 43%)`;
  }

  function signCodeFromTooltip(content) {
    const container = document.createElement('div');
    container.innerHTML = String(content ?? '');
    const lines = (container.textContent || '').split('\n').map((line) => line.trim()).filter(Boolean);
    // The existing DOT tooltip places the sign code after the notes on its second line.
    return lines[1]?.split('|').at(-1)?.trim() || '';
  }

  L.circleMarker = function (latlng, options = {}) {
    const markerOptions = { ...options };
    if (markerOptions.fillColor === BUS_STOP_FILL && Number.isFinite(markerOptions.radius)) {
      markerOptions.radius *= 3;
    }

    const marker = originalCircleMarker.call(this, latlng, markerOptions);
    if (markerOptions.fillColor !== DOT_SIGN_FILL) return marker;

    const originalBindTooltip = marker.bindTooltip;
    marker.bindTooltip = function (content, tooltipOptions) {
      this.setStyle({ fillColor: colorForSignCode(signCodeFromTooltip(content)) });
      return originalBindTooltip.call(this, content, tooltipOptions);
    };
    return marker;
  };
})();
