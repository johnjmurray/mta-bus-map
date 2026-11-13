const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const VEHICLE_ENDPOINT = 'https://bustime-classic.mta.info/api/siri/vehicle-monitoring.json';
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function sendJson(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  response.end(JSON.stringify(value));
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  if (requestUrl.pathname === '/api/vehicles') {
    const apiKey = process.env.MTA_API_KEY;
    if (!apiKey) {
      sendJson(response, 503, {
        error: 'Live vehicle tracking is not configured. Set MTA_API_KEY and restart the server.'
      });
      return;
    }

    const upstreamUrl = new URL(VEHICLE_ENDPOINT);
    upstreamUrl.searchParams.set('key', apiKey);
    upstreamUrl.searchParams.set('VehicleMonitoringDetailLevel', 'minimum');
    const lineRef = requestUrl.searchParams.get('lineRef');
    if (lineRef) upstreamUrl.searchParams.set('LineRef', lineRef);

    try {
      const upstream = await fetch(upstreamUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15000)
      });
      const body = await upstream.text();
      response.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*'
      });
      response.end(body);
    } catch (error) {
      sendJson(response, 502, { error: `Could not reach the MTA vehicle feed: ${error.message}` });
    }
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Method not allowed');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    response.writeHead(400);
    response.end('Bad request');
    return;
  }
  if (pathname === '/') pathname = '/index.html';

  const filePath = path.resolve(ROOT, `.${pathname}`);
  if (!filePath.startsWith(`${ROOT}${path.sep}`)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, contents) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500);
      response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    response.end(request.method === 'HEAD' ? undefined : contents);
  });
});

server.listen(PORT, () => {
  console.log(`MTA Bus Map is running at http://localhost:${PORT}`);
});
