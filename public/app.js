const $ = (id) => document.getElementById(id);
const form = $('review-form');
const fields = $('brief-fields');
const run = $('run-review');
const load = $('load-example');
const error = $('form-error');
const categoryList = $('categories');
const report = $('report-content');
const modeLabel = { local: 'Local checklist', foundry: 'Microsoft Foundry' };
const severityLabel = { high: 'High', medium: 'Medium', low: 'Low', question: 'Question' };
let config;
let completed = 0;

function node(tag, value) {
  const element = document.createElement(tag);
  if (value !== undefined) element.textContent = value;
  return element;
}

function setError(message) {
  error.textContent = message;
  error.hidden = !message;
}

async function api(path, options) {
  const response = await fetch(path, options);
  if (response.status === 401) throw new Error('Sign in to the workspace and reload this page.');
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('The review service did not respond as expected. Reload the page and try again.');
  }
  const body = await response.json();
  if (!response.ok) throw new Error(body.error);
  return body;
}

function sourceLink(link, source) {
  link.textContent = source.title;
  link.href = source.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function rating(label) {
  const group = node('div');
  group.className = 'rating';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label);
  const buttons = ['Helpful', 'Incorrect', 'Not applicable'].map((value) => {
    const button = node('button', value);
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      const selected = button.getAttribute('aria-pressed') !== 'true';
      for (const other of buttons) other.setAttribute('aria-pressed', String(other === button && selected));
    });
    return button;
  });
  group.append(...buttons);
  return group;
}

function findingCard(finding, open) {
  const card = $('finding-template').content.firstElementChild.cloneNode(true);
  const category = config.rubric.find(({ id }) => id === finding.category).label;
  card.open = open;
  card.querySelector('.category').textContent = category;
  const badge = card.querySelector('.severity');
  badge.dataset.level = finding.severity;
  badge.textContent = severityLabel[finding.severity];
  card.querySelector('.finding-title').textContent = finding.finding;
  for (const part of ['evidence', 'action', 'question']) {
    const section = card.querySelector(`[data-part="${part}"]`);
    section.hidden = !finding[part];
    section.lastElementChild.textContent = finding[part] ?? '';
  }
  card.querySelector('.finding-guidance').textContent = finding.source.guidance;
  sourceLink(card.querySelector('.finding-source'), finding.source);
  card.querySelector('.finding-rating').append(rating(`Rate the ${category} finding`));
  return card;
}

function render(result) {
  const { findings, deployment, usage, latencyMs } = result;
  const questions = findings.filter(({ severity }) => severity === 'question').length;
  const gaps = findings.length - questions;
  const counts = `${gaps} ${gaps === 1 ? 'gap' : 'gaps'} / ${questions} ${questions === 1 ? 'question' : 'questions'}`;
  const metrics = [
    ['Review time', latencyMs < 1 ? '<1 ms' : `${latencyMs.toLocaleString()} ms`],
    ['Reviews this tab', String(++completed)],
  ];
  if (deployment) metrics.push(['Model deployment', deployment]);
  if (usage) {
    metrics.push(['Input / output tokens', `${usage.inputTokens.toLocaleString()} / ${usage.outputTokens.toLocaleString()}`]);
    if (usage.estimatedUsd !== null) metrics.push(['Estimated model cost', `$${usage.estimatedUsd.toFixed(6)} USD`]);
  }
  $('metrics').replaceChildren(...metrics.map(([term, value]) => {
    const item = node('div');
    item.append(node('dt', term), node('dd', value));
    return item;
  }));
  $('report-count').textContent = counts;
  $('findings').replaceChildren(...(findings.length
    ? findings.map((finding, i) => findingCard(finding, i === 0))
    : [node('p', 'No findings were returned. Confirm the design against the rubric before sign-off.')]));
  if (!findings.length) $('findings').firstElementChild.className = 'panel-body';
  $('overall-rating').replaceChildren(rating('Rate the overall review'));
  $('review-note').value = '';
  $('empty').hidden = true;
  report.hidden = false;
  $('status').textContent = `Review complete. ${counts}.`;
  $('report-title').focus();
}

load.addEventListener('click', () => {
  const { architecture, requirements, workload } = config.scenario;
  $('architecture').value = architecture;
  $('requirements').value = requirements;
  $('workload').value = workload;
  for (const box of categoryList.querySelectorAll('input')) box.checked = true;
  setError('');
  $('architecture').focus();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (run.disabled) return;
  const input = new FormData(form);
  const brief = {
    architecture: input.get('architecture'),
    workload: input.get('workload'),
    requirements: input.get('requirements'),
    categories: input.getAll('category'),
  };
  if (!brief.architecture.trim()) {
    setError('Enter an architecture description.');
    $('architecture').focus();
    return;
  }
  if (!brief.categories.length) {
    setError('Select at least one review category.');
    categoryList.querySelector('input').focus();
    return;
  }
  setError('');
  fields.disabled = run.disabled = load.disabled = true;
  $('run-label').textContent = 'Reviewing';
  report.hidden = true;
  $('report-count').textContent = '';
  $('empty-title').textContent = 'Review in progress';
  $('empty-detail').textContent = `Checking the brief with ${modeLabel[config.mode]}.`;
  $('empty').hidden = false;
  $('report-body').setAttribute('aria-busy', 'true');
  $('status').textContent = 'Review in progress.';
  try {
    render(await api('/api/review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(brief),
    }));
  } catch (failure) {
    setError(failure.message);
    $('status').textContent = 'Review failed.';
    $('empty-title').textContent = 'Review unavailable';
    $('empty-detail').textContent = 'Your brief is unchanged. Check the message below the form and try again.';
  } finally {
    fields.disabled = run.disabled = load.disabled = false;
    $('run-label').textContent = 'Run review';
    $('report-body').removeAttribute('aria-busy');
  }
});

try {
  config = await api('/api/config');
  $('mode').dataset.mode = config.mode;
  $('mode-label').textContent = modeLabel[config.mode];
  $('data-notice').textContent = config.mode === 'foundry'
    ? 'Synthetic or sanitized text only. Sent to your Foundry deployment.'
    : 'Synthetic or sanitized text only. No model calls in this mode.';
  $('workload').append(...Object.entries(config.workloads).map(([id, name]) => new Option(name, id)));
  $('architecture').maxLength = config.limits.architecture;
  $('requirements').maxLength = config.limits.requirements;
  for (const { id, label, source } of config.rubric) {
    const option = node('label');
    const checkbox = node('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'category';
    checkbox.value = id;
    checkbox.checked = true;
    option.append(checkbox, label);
    categoryList.append(option);
    const item = node('li');
    item.append(sourceLink(node('a'), source));
    $('sources').append(item);
  }
  fields.disabled = run.disabled = load.disabled = false;
} catch (failure) {
  $('mode-label').textContent = 'Unavailable';
  setError(failure.message);
}
