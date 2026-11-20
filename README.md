# Azure AI Architecture Review Agent

A Hack-to-Build PoC for partner architects. Paste an Azure AI design and workload requirements, select up to five review categories, and get potential gaps, evidence quoted from the brief, Microsoft Learn guidance, and clarification questions. Rate findings and note missed issues in the same tab. This is a first-pass review, not design approval.

## Run the demo

Use Node.js 22.13+ (or 24 LTS). From this directory in Windows PowerShell:

```powershell
npm.cmd ci
npm.cmd start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000), select **Load example**, then **Run review**. The synthetic policy assistant produces five gaps. Open the identity finding, compare the architecture quote with the Microsoft Learn source, and mark the finding **Helpful**. To demonstrate a missing detail, replace the architecture with `An internal assistant runs on Azure App Service.`, select only **Reliability**, and run again. The result is a question, not an asserted gap.

The default **Local checklist** runs without Azure credentials or network calls. It matches a few patterns rather than reasoning over the design. **Microsoft Foundry** mode looks up current Microsoft Learn docs for the workload, then uses a deployed model to assess the brief. The report shows review latency and model token usage. The optional rate settings in [.env.example](.env.example) estimate model cost only, not hosting or total pilot cost.

Run `npm.cmd test` for the local workflow, documentation lookup, and Foundry contract checks. The tests stub the external services.

## Use the verified Hack-to-Build sandbox

Use the **sandbox** Entra account and subscription, not your personal Azure environment. The app needs the full **Foundry Responses endpoint**, the **model deployment name**, and an authorized identity. Do not copy passwords, tokens, or API keys into the repo or chat.

1. Reuse an Azure OpenAI deployment that supports [Responses](https://learn.microsoft.com/azure/foundry/openai/how-to/responses) and [structured outputs](https://learn.microsoft.com/azure/foundry/openai/how-to/structured-outputs), such as `gpt-6.1-terra`. Copy the deployment's **Name** from Foundry; it can differ from the model name. Use the resource endpoint `https://<sandbox-resource>.services.ai.azure.com/openai/v1/responses`. The app also accepts the project route, but the sandbox deployment uses the resource route because the project route returned HTTP 403 with the inference role below.
2. To test locally, give your sandbox user [**Cognitive Services OpenAI User**](https://learn.microsoft.com/azure/foundry/openai/how-to/role-based-access-control) on the Foundry resource. Use an isolated CLI profile in the same PowerShell window that will run the app:

   ```powershell
   $env:AZURE_CONFIG_DIR = Join-Path $env:LOCALAPPDATA 'azure-htb-sandbox'
   $env:AZURE_SUBSCRIPTION_ID = '<sandbox-subscription-id>'
   az login --tenant '<sandbox-tenant-id>'
   az account show --subscription $env:AZURE_SUBSCRIPTION_ID --query '{subscription:id,tenant:tenantId}' -o table
   ```

   Verify that both IDs match your sandbox. Then set these values and restart the app:

   ```powershell
   $env:REVIEW_MODE = 'foundry'
   $env:AZURE_OPENAI_ENDPOINT = 'https://<sandbox-resource>.services.ai.azure.com/openai/v1/responses'
   $env:AZURE_OPENAI_DEPLOYMENT = '<sandbox-deployment-name>'
   npm.cmd start
   ```

3. Use the existing **Linux Node.js 22+ App Service** in the sandbox. Configure [App Service Authentication with Microsoft Entra ID](https://learn.microsoft.com/azure/app-service/configure-authentication-provider-aad) to **Require authentication**, limit access to the intended sandbox users, and require HTTPS before deploying. Enable the app's **system-assigned managed identity** and give it **Cognitive Services OpenAI User** on the parent Foundry resource. Set `REVIEW_MODE=foundry`, `AZURE_OPENAI_ENDPOINT`, and `AZURE_OPENAI_DEPLOYMENT` as App Service settings. The hosted app uses managed identity, not Azure CLI or API keys.

   If you create the Entra app registration manually and App Service requests `code id_token`, enable **ID tokens** under **App registrations > Authentication > Implicit grant and hybrid flows**. Leave **Access tokens** off. Start a new sign-in from the app URL instead of refreshing `/.auth/login/aad/callback`.

   Keep `Referrer-Policy: same-origin` so App Service Authentication can verify the signed-in review POST. The browser still withholds the referrer from external sites.

4. Set the Linux startup command to `npm start` and the app setting `SCM_DO_BUILD_DURING_DEPLOYMENT=true`. [Deploy a ZIP](https://learn.microsoft.com/azure/app-service/deploy-zip) with `package.json`, `package-lock.json`, `server.js`, `review.js`, `foundry.js`, `learn.js`, and `public/` at its root. Exclude `.env`, `node_modules/`, and anything containing credentials. Open the app after signing in and run the synthetic example. The report should show **Microsoft Learn (live)**, linked docs, and model token counts. Learn MCP needs outbound HTTPS to `learn.microsoft.com`, not another Azure resource or credential.

## PoC boundaries

The Node app searches the [Microsoft Learn MCP Server](https://learn.microsoft.com/training/support/mcp) for each selected category using recognized public Azure service names or general workload terms. It never sends brief text to Learn and only uses official documentation results. It sends the retrieved excerpts and the brief to the [Foundry Responses API](https://learn.microsoft.com/azure/foundry/openai/how-to/responses) with a JSON schema and `store: false` to disable response storage by the API. For each gap, the server verifies the evidence quote and attaches the cited excerpt and its original link. If Learn is unavailable, live mode reports the error rather than falling back to the static checklist. An architect still verifies that the quote and guidance support the finding.

There is no database, Agent Service project, or Azure AI Search dependency. The app does not persist briefs or log prompt content; form inputs, findings, and feedback are held in the open tab. Feedback resets with a new review. Live mode sends the submitted text to the configured Foundry resource, so use only synthetic or sanitized material. Pilot quality targets and time saved are not measured by this PoC.