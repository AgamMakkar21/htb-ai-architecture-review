import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { foundryReviewer } from '../foundry.js';
import { readBrief, rubric, scenario } from '../review.js';
import { createApp } from '../server.js';

test('the local app runs the example and asks questions when details are missing', async (t) => {
  const server = createApp().listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(base);
  assert.match(await page.text(), /Azure AI architecture review/);
  const config = await (await fetch(`${base}/api/config`)).json();
  const categories = config.rubric.map(({ id }) => id);
  const submit = (body) => fetch(`${base}/api/review`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

  const demo = await submit({ ...config.scenario, categories });
  assert.equal(demo.status, 200);
  const report = await demo.json();
  assert.equal(report.mode, 'local');
  assert.equal(report.usage, null);
  assert.equal(report.findings.length, 5);
  assert.ok(report.findings.every((item) =>
    item.action && item.evidence && config.scenario.architecture.includes(item.evidence) &&
    item.source.url.startsWith('https://learn.microsoft.com/')));

  const partial = await submit({
    ...config.scenario, architecture: 'The application runs on App Service.', categories: ['reliability'],
  });
  const { findings } = await partial.json();
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'question');
  assert.equal(findings[0].evidence, null);
  assert.match(findings[0].question, /throttles/);

  const invalid = await submit({ ...config.scenario, categories: [] });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /review categories/);
});

test('Foundry receives a bounded rubric and returns a cited finding and model usage', async () => {
  const brief = readBrief({ ...scenario, categories: ['identity'] });
  const evaluate = foundryReviewer({
    endpoint: 'https://sandbox.openai.azure.com/openai/v1/chat/completions',
    deployment: 'sandbox-mini',
    getToken: async () => 'test-token',
    inputPrice: 1,
    outputPrice: 2,
    request: async (url, options) => {
      assert.equal(new URL(url).pathname, '/openai/v1/chat/completions');
      assert.equal(options.headers.authorization, 'Bearer test-token');
      const request = JSON.parse(options.body);
      assert.equal(request.model, 'sandbox-mini');
      assert.equal(request.response_format.json_schema.strict, true);
      assert.deepEqual(request.response_format.json_schema.schema.properties.findings.items.properties.category.enum, ['identity']);
      assert.equal(request.store, false);
      assert.ok(!request.messages[0].content.includes(brief.architecture));
      assert.equal(JSON.parse(request.messages[1].content).architecture, brief.architecture);
      return modelResponse('The application uses a shared admin key to query Search');
    },
  });
  const report = await evaluate(brief);
  assert.equal(report.findings[0].source.url, rubric[0].source.url);
  assert.equal(report.usage.estimatedUsd, 0.00014);
});

test('Foundry output with fabricated evidence is not returned as a successful review', async () => {
  const evaluate = foundryReviewer({
    endpoint: 'https://sandbox.openai.azure.com/openai/v1/chat/completions',
    deployment: 'sandbox-mini',
    getToken: async () => 'test-token',
    request: async () => modelResponse('The model accepts anonymous requests.'),
  });
  await assert.rejects(evaluate(readBrief({ ...scenario, categories: ['identity'] })), {
    status: 502,
    message: /evidence checks/,
  });
});

function modelResponse(evidence) {
  return Response.json({
    choices: [{
      finish_reason: 'stop',
      message: { content: JSON.stringify({ findings: [{
        category: 'identity',
        severity: 'high',
        finding: 'A read-only operation uses an admin key.',
        evidence,
        action: 'Use a managed identity scoped to Search Index Data Reader.',
        question: null,
        source: { url: 'https://example.invalid' },
      }] }) },
    }],
    usage: { prompt_tokens: 100, completion_tokens: 20 },
  });
}
