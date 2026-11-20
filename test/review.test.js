import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { configureFoundry, foundryReviewer } from '../foundry.js';
import { readBrief, rubric, scenario } from '../review.js';
import { createApp } from '../server.js';

const endpoint = 'https://sandbox.services.ai.azure.com/openai/v1/responses';

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
  const config = configureFoundry({
    AZURE_OPENAI_ENDPOINT: endpoint,
    AZURE_OPENAI_DEPLOYMENT: 'review-deployment',
    FOUNDRY_INPUT_USD_PER_MILLION: '1',
    FOUNDRY_OUTPUT_USD_PER_MILLION: '2',
  }, true);
  const evaluate = foundryReviewer({
    ...config,
    getToken: async () => 'test-token',
    request: async (url, options) => {
      assert.equal(url, endpoint);
      assert.equal(options.headers.authorization, 'Bearer test-token');
      const request = JSON.parse(options.body);
      assert.equal(request.model, 'review-deployment');
      assert.equal(request.text.format.strict, true);
      assert.deepEqual(request.text.format.schema.properties.findings.items.properties.category.enum, ['identity']);
      assert.equal(request.store, false);
      assert.ok(!request.instructions.includes(brief.architecture));
      assert.equal(JSON.parse(request.input).architecture, brief.architecture);
      return Response.json(modelResult('The application uses a shared admin key to query Search'));
    },
  });
  const report = await evaluate(brief);
  assert.equal(report.findings[0].source.url, rubric[0].source.url);
  assert.deepEqual(report.usage, { inputTokens: 100, outputTokens: 20, estimatedUsd: 0.00014 });
});

test('Foundry output with fabricated evidence is not returned as a successful review', async () => {
  const evaluate = foundryReviewer({
    endpoint,
    deployment: 'review-deployment',
    getToken: async () => 'test-token',
    request: async () => Response.json(modelResult('The model accepts anonymous requests.')),
  });
  await assert.rejects(evaluate(readBrief({ ...scenario, categories: ['identity'] })), {
    status: 502,
    message: /evidence checks/,
  });
});

test('Foundry refusals and incomplete outputs do not become reviews', async () => {
  const brief = readBrief({ ...scenario, categories: ['identity'] });
  const report = modelResult('The application uses a shared admin key to query Search');
  for (const [result, message] of [
    [{ ...report, status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }, /incomplete review/],
    [{
      status: 'completed',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'Model refused.' }] }],
    }, /declined this brief/],
  ]) {
    const evaluate = foundryReviewer({
      endpoint,
      deployment: 'review-deployment',
      getToken: async () => 'test-token',
      request: async () => Response.json(result),
    });
    await assert.rejects(evaluate(brief), { status: 502, message });
  }
});

function modelResult(evidence) {
  return {
    status: 'completed',
    output: [{ type: 'reasoning', summary: [] }, {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: JSON.stringify({ findings: [{
        category: 'identity',
        severity: 'high',
        finding: 'A read-only operation uses an admin key.',
        evidence,
        action: 'Use a managed identity scoped to Search Index Data Reader.',
        question: null,
        source: { url: 'https://example.invalid' },
      }] }) }],
    }],
    usage: { input_tokens: 100, output_tokens: 20 },
  };
}
