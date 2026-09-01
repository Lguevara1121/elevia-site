# Elevia Stays inquiry intake integration

The Netlify Function at `/api/inquiry-intake` receives signed Netlify form-submission webhooks, downloads up to five uploaded property photos, and sends one clean branded intake message to `hello@eleviastays.com` with those photos as Outlook attachments. The shared implementation is exposed by both the root Elevia Enterprises deployment and the standalone `stays-site` deployment.

## Required Netlify environment variables

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `INTAKE_MAILBOX` = `hello@eleviastays.com`
- `NETLIFY_WEBHOOK_SECRET` = a long random value used in the Netlify webhook's JWS secret field
- `ALLOWED_UPLOAD_HOSTS` = `.cloudfront.net` (optional; comma-separated)

Set secrets in the Netlify dashboard. Do not commit them.

## One-time Microsoft Entra setup

1. Create a single-tenant app registration named `Elevia Stays Intake`.
2. Add Microsoft Graph **Application** permission `Mail.Send`.
3. Grant admin consent for Elevia Enterprises.
4. Create a client secret and immediately store its value in Netlify as `AZURE_CLIENT_SECRET`.
5. Store the Directory (tenant) ID and Application (client) ID in the corresponding Netlify variables.

For tighter mailbox scoping, use Exchange Online application access controls so the app may send only as `hello@eleviastays.com`.

## Netlify form webhook

In the Netlify site that receives the `inquiry` form:

1. Open **Project configuration → Notifications → Emails and webhooks**.
2. Add an outgoing webhook for verified `inquiry` form submissions.
3. Set its URL to `https://YOUR-SITE.netlify.app/api/inquiry-intake`.
4. Set its JWS secret to exactly the value stored as `NETLIFY_WEBHOOK_SECRET`.
5. After validation, remove the old Netlify email notification to prevent duplicate intake emails.

## Power Automate handoff

Update the existing flow trigger to process messages whose subject begins with `[Elevia Intake]`.

After **Create item**:

1. Add an **Apply to each** over the trigger's Attachments collection.
2. Inside it, use Outlook **Get attachment (V2)** with the message ID and attachment ID.
3. Add SharePoint **Add attachment** with the created List item ID, attachment name, and attachment content.
4. Keep the existing `Outlook Thread` mapping from the trigger's `webLink`.
5. Keep the existing confirmation and filing steps.

These are standard Outlook and SharePoint connectors; no Power Automate Premium license is required.
