export const limits = { architecture: 6000, requirements: 3000 };

export const workloads = {
  rag: 'Knowledge assistant (RAG)',
  chat: 'Conversational app',
  documents: 'Document processing',
  other: 'Other Azure AI workload',
};

export const scenario = {
  workload: 'rag',
  architecture: [
    'An internal policy assistant runs on Azure App Service. It retrieves passages from Azure AI Search and sends them to a model in Microsoft Foundry.',
    'The application uses a shared admin key to query Search. The search endpoint allows public network access.',
    'The application retries throttled requests immediately with no limit. The team tracks request counts but does not measure model latency or token usage.',
    'The team ships prompt changes without evaluating answer quality.',
  ].join('\n\n'),
  requirements: 'Employees need current policy answers from internal documents. The design must protect those documents and stay responsive during busy periods.',
};

export const rubric = [
  {
    id: 'identity',
    label: 'Identity and access',
    source: {
      title: 'Connect to Azure AI Search using roles',
      url: 'https://learn.microsoft.com/azure/search/search-security-rbac',
      guidance: 'Use Microsoft Entra ID and grant only the Azure AI Search role needed by the workload. Search Index Data Reader can query indexes without granting index management rights.',
    },
    questionTitle: 'Confirm service permissions',
    check: 'How does the app authenticate to downstream services, and which permissions does its identity need?',
    signal: /the application uses a shared admin key to query search/i,
    gap: 'The application uses an administrative credential for a read-only operation.',
    action: 'Use the app\'s managed identity and grant Search Index Data Reader at the narrowest applicable scope.',
    severity: 'high',
  },
  {
    id: 'security',
    label: 'Security and data',
    source: {
      title: 'Create a private endpoint for Azure AI Search',
      url: 'https://learn.microsoft.com/azure/search/service-create-private-endpoint',
      guidance: 'Azure AI Search private endpoints support access through a virtual network. Disable public network access if the workload requires private-only access.',
    },
    questionTitle: 'Confirm the data access boundary',
    check: 'Which network paths can reach the data services, and how is access restricted for internal documents?',
    signal: /the search endpoint allows public network access/i,
    gap: 'The Search endpoint accepts public connections. Check whether that meets the access policy for internal documents.',
    action: 'Confirm the network policy. If it requires private access, use a Search private endpoint and disable public network access.',
    severity: 'medium',
  },
  {
    id: 'reliability',
    label: 'Reliability',
    source: {
      title: 'Handle Azure OpenAI rate limits',
      url: 'https://learn.microsoft.com/microsoft-cloud/dev/dev-proxy/concepts/azure-openai-429-token-rate-limit#how-to-handle-an-azure-openai-429',
      guidance: 'Honor retry-after-ms when provided. Otherwise use exponential backoff with jitter and cap retries; failed attempts also count toward the rate limit.',
    },
    questionTitle: 'Confirm throttling and fallback behavior',
    check: 'What happens when the model endpoint throttles a request or becomes unavailable?',
    signal: /the application retries throttled requests immediately with no limit/i,
    gap: 'Immediate, unlimited retries can amplify throttling during traffic spikes.',
    action: 'Honor the service retry delay, use backoff with jitter otherwise, and cap retries within the request timeout.',
    severity: 'medium',
  },
  {
    id: 'observability',
    label: 'Observability',
    source: {
      title: 'Azure OpenAI monitoring metrics',
      url: 'https://learn.microsoft.com/azure/foundry/openai/monitor-openai-reference#metrics',
      guidance: 'Azure Monitor exposes request, token consumption, and latency metrics for Azure OpenAI. Metrics can be correlated with deployment and reviewed without storing full prompts.',
    },
    questionTitle: 'Confirm model telemetry',
    check: 'Which measurements will show latency, model errors, and token consumption during the pilot?',
    signal: /does not measure model latency or token usage/i,
    gap: 'Request counts alone will not reveal slow responses or increasing token consumption.',
    action: 'Track model latency and token consumption by deployment in Azure Monitor. Keep architecture and prompt text out of telemetry.',
    severity: 'low',
  },
  {
    id: 'governance',
    label: 'Responsible AI',
    source: {
      title: 'Test and evaluate AI workloads on Azure',
      url: 'https://learn.microsoft.com/azure/well-architected/ai/test',
      guidance: 'Evaluate AI workloads against representative inputs and defined quality and safety criteria. Reevaluate after changes to the prompt, model, or retrieval pipeline.',
    },
    questionTitle: 'Confirm the evaluation criteria',
    check: 'Which evaluation cases and human review criteria must prompt changes pass before release?',
    signal: /the team ships prompt changes without evaluating answer quality/i,
    gap: 'Prompt changes are shipped without a check for answer-quality regressions.',
    action: 'Use representative policy questions and have an architect check groundedness and answer quality before releasing prompt changes.',
    severity: 'medium',
  },
];

export class ReviewError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function readBrief(body) {
  const { workload, categories } = body ?? {};
  const architecture = typeof body?.architecture === 'string' ? body.architecture.trim() : '';
  const requirements = typeof body?.requirements === 'string' ? body.requirements.trim() : '';
  if (!architecture || architecture.length > limits.architecture) {
    throw new ReviewError(400, `Enter an architecture description of 1 to ${limits.architecture} characters.`);
  }
  if (typeof body.requirements !== 'string' || requirements.length > limits.requirements) {
    throw new ReviewError(400, `Enter no more than ${limits.requirements} characters of requirements.`);
  }
  if (!Object.hasOwn(workloads, workload)) throw new ReviewError(400, 'Select a workload.');
  const checks = rubric.filter(({ id }) => Array.isArray(categories) && categories.includes(id));
  if (!checks.length || checks.length !== categories.length) {
    throw new ReviewError(400, 'Select one or more valid review categories.');
  }
  return { architecture, requirements, workload, checks };
}

export function localFindings({ architecture, requirements, checks }) {
  return checks.map((check) => {
    const evidence = architecture.match(check.signal)?.[0] ?? requirements.match(check.signal)?.[0] ?? null;
    return {
      category: check.id,
      severity: evidence ? check.severity : 'question',
      finding: evidence ? check.gap : check.questionTitle,
      evidence,
      action: evidence ? check.action : null,
      question: evidence ? null : check.check,
      source: check.source,
    };
  });
}
