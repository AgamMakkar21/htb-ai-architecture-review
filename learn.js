import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ReviewError } from './review.js';

const endpoint = new URL('https://learn.microsoft.com/api/mcp?maxTokenBudget=2000');
const docsPath = /^\/(?:[a-z]{2}-[a-z]{2}\/)?(?:azure|entra|security|dotnet|microsoft-cloud)\//i;
const services = [
  ['Azure AI Document Intelligence', /\b(?:document intelligence|form recognizer)\b/i],
  ['Azure AI Search', /\b(?:azure (?:ai|cognitive) search|foundry iq)\b/i],
  ['Azure AI Speech', /\bazure (?:ai )?speech\b/i],
  ['Azure AI Vision', /\b(?:azure (?:ai )?vision|azure computer vision)\b/i],
  ['Azure AI Language', /\bazure (?:ai )?language\b/i],
  ['Azure OpenAI', /\bazure openai\b/i],
  ['Microsoft Foundry', /\b(?:microsoft foundry|azure ai foundry)\b/i],
  ['Azure Cosmos DB', /\bcosmos db\b/i],
  ['Azure Blob Storage', /\b(?:azure storage|blob storage)\b/i],
  ['Azure Key Vault', /\bkey vault\b/i],
  ['Azure API Management', /\bazure api management\b/i],
  ['Azure Container Apps', /\b(?:azure )?container apps\b/i],
  ['Azure Functions', /\bazure functions\b/i],
  ['Azure App Service', /\bapp service\b/i],
];
const workloadTerms = {
  rag: 'Azure retrieval augmented generation workload',
  chat: 'Azure AI conversational workload',
  documents: 'Azure AI document processing workload',
  other: 'Azure AI workload',
};
const topics = {
  identity: 'authentication Microsoft Entra ID managed identity RBAC built-in roles',
  security: 'data security private endpoints public network access firewall',
  reliability: 'service limits throttling rate limits retry backoff',
  observability: 'Azure Monitor diagnostic logs metrics latency token usage',
  governance: 'testing and evaluating AI workloads quality safety model and prompt changes',
};

function queryFor({ architecture, requirements, workload, checks }) {
  // Only public catalog terms leave the app for Learn, never text copied from the brief.
  const mentioned = services.filter(([, pattern]) => pattern.test(`${architecture}\n${requirements}`))
    .map(([name]) => name);
  const model = mentioned.find((name) => name === 'Azure OpenAI' || name === 'Microsoft Foundry');
  const primary = mentioned[0] ?? workloadTerms[workload];
  return checks.map(({ id }) => {
    const target = id === 'governance' ? 'Azure Well-Architected'
      : (id === 'reliability' || id === 'observability') ? model ?? primary : primary;
    return `${target} ${topics[id]}`;
  });
}

async function searchLearn(queries) {
  const signal = AbortSignal.timeout(12000);
  const client = new Client({ name: 'architecture-review-poc', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(endpoint, {
    fetch: (url, init) => fetch(url, {
      ...init,
      redirect: 'error',
      signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal,
    }),
  });
  try {
    await client.connect(transport, { signal });
    const { tools } = await client.listTools(undefined, { signal });
    const search = tools.find(({ name, inputSchema }) =>
      name === 'microsoft_docs_search' && inputSchema.properties?.query?.type === 'string');
    if (!search) throw new ReviewError(502, 'Microsoft Learn did not expose a compatible documentation search tool.');

    return await Promise.all(queries.map(async (query) => {
      const result = await client.callTool({ name: search.name, arguments: { query } }, undefined, { signal });
      if (result.isError || !Array.isArray(result.structuredContent?.results)) {
        throw new ReviewError(502, 'Microsoft Learn did not return usable documentation results. Run the review again.');
      }
      return result.structuredContent.results;
    }));
  } catch (error) {
    if (error instanceof ReviewError) throw error;
    if (signal.aborted) throw new ReviewError(504, 'Microsoft Learn lookup timed out. Run the review again.');
    throw new ReviewError(502, 'Could not search Microsoft Learn. Run the review again.');
  } finally {
    await client.close();
  }
}

function passage(item) {
  const url = typeof item?.contentUrl === 'string' && URL.parse(item.contentUrl);
  if (!url || url.origin !== endpoint.origin || url.username || url.password ||
      !docsPath.test(url.pathname) || typeof item.content !== 'string' || typeof item.title !== 'string') return null;
  const title = item.title.trim().slice(0, 240);
  const excerpt = item.content.replace(/\[([^\]\n]+)\]\([^)\n]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '').replace(/\s+/g, ' ').trim().slice(0, 1600);
  return title && excerpt ? { title, excerpt, url: url.href } : null;
}

export async function lookupLearn(brief, search = searchLearn) {
  const results = await search(queryFor(brief));
  const sources = brief.checks.flatMap(({ id }, index) => {
    const usable = results[index].map(passage).filter(Boolean);
    const unique = [...new Map(usable.map((source) => [source.url, source])).values()];
    return unique.slice(0, 3).map((source, i) => ({ ...source, id: `${id}-${i + 1}`, category: id }));
  });
  if (!sources.length) {
    throw new ReviewError(422, 'Microsoft Learn found no usable guidance. Try naming the Azure services in the brief.');
  }
  return sources;
}
