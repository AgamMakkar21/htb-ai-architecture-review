import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { configureFoundry, foundryReviewer } from './foundry.js';
import { limits, localFindings, readBrief, ReviewError, rubric, scenario, workloads } from './review.js';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']],
]);
const order = ['high', 'medium', 'low', 'question'];
const maxBytes = 64 * 1024;
const headers = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'",
  // App Service Authentication checks the referrer on signed-in browser POSTs.
  'referrer-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
};

function send(res, status, contentType, body) {
  res.writeHead(status, { ...headers, 'content-type': contentType });
  res.end(body);
}

function json(res, status, body) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(body));
}

async function readJson(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new ReviewError(415, 'Send the brief as JSON.');
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      req.resume();
      throw new ReviewError(413, 'The review brief is too large.');
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ReviewError(400, 'The review brief is not valid JSON.');
  }
}

export function createApp({ mode = 'local', deployment = null, review, appService = false } = {}) {
  const config = {
    mode, deployment, rubric: rubric.map(({ id, label, source }) => ({ id, label, source })),
    limits, workloads, scenario,
  };
  return createServer(async (req, res) => {
    const path = req.url.split('?')[0];
    try {
      if (appService && path.startsWith('/api/') && !req.headers['x-ms-client-principal-id']) {
        throw new ReviewError(401, 'Sign in through Azure App Service Authentication to use this workspace.');
      }
      if (!appService && !/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(req.headers.host ?? '')) {
        throw new ReviewError(403, 'Use the local app address.');
      }
      if (req.method === 'GET' && assets.has(path)) {
        const [file, type] = assets.get(path);
        return send(res, 200, type, await readFile(new URL(`./public/${file}`, import.meta.url)));
      }
      if (req.method === 'GET' && path === '/api/config') return json(res, 200, config);
      if (req.method === 'POST' && path === '/api/review') {
        const brief = readBrief(await readJson(req));
        const start = performance.now();
        const { findings, usage } = mode === 'foundry'
          ? await review(brief)
          : { findings: localFindings(brief), usage: null };
        findings.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
        return json(res, 200, {
          id: randomUUID(), mode, deployment, findings, usage,
          latencyMs: Math.round(performance.now() - start),
        });
      }
      throw new ReviewError(404, 'This route does not exist.');
    } catch (error) {
      if (error instanceof ReviewError) {
        if (error.status >= 500) console.error(error.message);
        return json(res, error.status, { error: error.message });
      }
      console.error('Unexpected review workspace error.');
      return json(res, 500, { error: 'The workspace could not complete the request. Try again.' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const mode = process.env.REVIEW_MODE ?? 'local';
    if (mode !== 'local' && mode !== 'foundry') throw new Error('REVIEW_MODE must be local or foundry.');
    const appService = Boolean(process.env.WEBSITE_SITE_NAME);
    const foundry = mode === 'foundry' ? configureFoundry(process.env, appService) : null;
    const port = Number(process.env.PORT ?? 3000);
    const host = appService ? '0.0.0.0' : '127.0.0.1';
    createApp({
      mode, appService, deployment: foundry?.deployment, review: foundry && foundryReviewer(foundry),
    }).on('error', (error) => {
      console.error(`Cannot start the workspace: ${error.code ?? 'server error'}.`);
      process.exitCode = 1;
    }).listen(port, host, () => console.log(`Architecture Review Agent (${mode}): http://${host}:${port}`));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
