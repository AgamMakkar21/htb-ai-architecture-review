# Azure AI Architecture Review Agent

A Hack-to-Build PoC for partner architects. Paste an Azure AI design and workload requirements, select up to five review categories, and get potential gaps, evidence quoted from the brief, Microsoft Learn guidance, and clarification questions. Rate findings and note missed issues in the same tab. This is a first-pass review, not design approval.

## Run the demo

Use Node.js 22.13+ (or 24 LTS). From this directory in Windows PowerShell:

```powershell
npm.cmd ci
npm.cmd start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000), select **Load example**, then **Run review**. The synthetic policy assistant produces five gaps. Open the identity finding, compare the architecture quote with the Microsoft Learn source, and mark the finding **Helpful**. To demonstrate a missing detail, replace the architecture with `An internal assistant runs on Azure App Service.`, select only **Reliability**, and run again. The result is a question, not an asserted gap.

The default **Local checklist** runs without Azure credentials or model calls. It matches a few patterns and asks for clarification on the remaining categories; it does not reason over the design. **Microsoft Foundry** mode uses a deployed model to assess the brief and returns its latency and token usage. The optional rate settings in [.env.example](.env.example) add an estimate of model cost only, not hosting or total pilot cost.

Run `npm.cmd test` for the local workflow and Foundry contract checks. The contract tests use a stub; they do not call Azure.

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
4. Set the Linux startup command to `npm start` and the app setting `SCM_DO_BUILD_DURING_DEPLOYMENT=true`. [Deploy a ZIP](https://learn.microsoft.com/azure/app-service/deploy-zip) with `package.json`, `package-lock.json`, `server.js`, `review.js`, `foundry.js`, and `public/` at its root. Exclude `.env`, `node_modules/`, and anything containing credentials. Open the app after signing in, run the synthetic example, and verify that the report shows **Microsoft Foundry** mode and token counts.

## PoC boundaries

The Node app sends the selected Microsoft Learn summaries and the brief to the [Foundry Responses API](https://learn.microsoft.com/azure/foundry/openai/how-to/responses) with a JSON schema and `store: false` to disable response storage by the API. It checks that evidence is quoted from the brief and attaches the citation for each selected check itself. An architect still verifies that the quote and guidance support the finding.

There is no database, Agent Service project, or Azure AI Search dependency. The app does not persist briefs or log prompt content; form inputs, findings, and feedback are held in the open tab. Feedback resets with a new review. Live mode sends the submitted text to the configured Foundry resource, so use only synthetic or sanitized material. Pilot quality targets and time saved are not measured by this PoC.