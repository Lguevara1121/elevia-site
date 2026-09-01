import crypto from "node:crypto";

const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 1_500_000;
const DEFAULT_UPLOAD_HOST_SUFFIXES = [".cloudfront.net", ".netlify.app"];

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function env(name) {
  return globalThis.Netlify?.env?.get(name) || process.env[name] || "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function base64UrlToBuffer(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  return Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="), "base64");
}

export function verifyNetlifySignature(rawBody, signature, secret) {
  if (!secret || !signature) return false;
  const parts = signature.split(".");
  if (parts.length !== 3) return false;

  try {
    const [headerPart, payloadPart, signaturePart] = parts;
    const header = JSON.parse(base64UrlToBuffer(headerPart).toString("utf8"));
    const payload = JSON.parse(base64UrlToBuffer(payloadPart).toString("utf8"));
    if (header.alg !== "HS256" || payload.iss !== "netlify") return false;

    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${headerPart}.${payloadPart}`)
      .digest();
    const received = base64UrlToBuffer(signaturePart);
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return false;

    const bodyHash = crypto.createHash("sha256").update(rawBody).digest("hex");
    return typeof payload.sha256 === "string" &&
      crypto.timingSafeEqual(Buffer.from(payload.sha256), Buffer.from(bodyHash));
  } catch {
    return false;
  }
}

function submissionData(payload) {
  return payload?.data || payload?.payload?.data || payload?.submission?.data || {};
}

function stringValue(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function fileUrl(value) {
  if (typeof value === "string" && /^https:\/\//i.test(value)) return value;
  if (!value || typeof value !== "object") return "";
  for (const key of ["url", "secure_url", "download_url", "href"]) {
    if (typeof value[key] === "string" && /^https:\/\//i.test(value[key])) return value[key];
  }
  return "";
}

export function extractPhotoUrls(data) {
  return Array.from({ length: MAX_PHOTOS }, (_, index) => {
    const field = `property_photo_${index + 1}`;
    return { field, url: fileUrl(data[field]) };
  }).filter((photo) => photo.url);
}

function permittedUploadHost(hostname) {
  const configured = env("ALLOWED_UPLOAD_HOSTS")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  const suffixes = configured.length ? configured : DEFAULT_UPLOAD_HOST_SUFFIXES;
  const host = hostname.toLowerCase();
  return suffixes.some((suffix) => host === suffix.replace(/^\./, "") || host.endsWith(suffix));
}

function safeFilename(value, fallback) {
  const cleaned = String(value || fallback)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return cleaned || fallback;
}

async function downloadPhoto(photo, index) {
  const url = new URL(photo.url);
  if (url.protocol !== "https:" || !permittedUploadHost(url.hostname)) {
    throw new Error(`Photo ${index + 1} uses an unapproved upload host.`);
  }

  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Photo ${index + 1} could not be downloaded.`);

  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_PHOTO_BYTES) throw new Error(`Photo ${index + 1} is too large.`);

  const contentType = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
  if (!contentType.startsWith("image/")) throw new Error(`Photo ${index + 1} is not an image.`);

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_PHOTO_BYTES) throw new Error(`Photo ${index + 1} is too large.`);

  const extension = ({
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "image/heif": ".heif",
  })[contentType] || ".jpg";
  const pathnameName = decodeURIComponent(url.pathname.split("/").pop() || "");
  const filename = safeFilename(pathnameName, `property-photo-${index + 1}${extension}`);

  return {
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: filename.includes(".") ? filename : `${filename}${extension}`,
    contentType,
    contentBytes: bytes.toString("base64"),
  };
}

async function graphToken() {
  const tenantId = env("AZURE_TENANT_ID");
  const clientId = env("AZURE_CLIENT_ID");
  const clientSecret = env("AZURE_CLIENT_SECRET");
  if (!tenantId || !clientId || !clientSecret) throw new Error("Microsoft integration is not configured.");

  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!response.ok) throw new Error("Microsoft authentication failed.");
  return (await response.json()).access_token;
}

function displayLeadType(value) {
  return ({
    property_owner: "Property Owner",
    seeking_housing: "Seeking Housing",
    corporate_partner: "Corporate Partner",
    general: "General Inquiry",
  })[value] || "Website Inquiry";
}

function humanLabel(key) {
  return key
    .replace(/^(po|sh|cp|gen)_/, "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const OMITTED_FIELDS = new Set([
  "form-name", "bot-field", "automation_payload", "g-recaptcha-response",
  "property_photo_1", "property_photo_2", "property_photo_3", "property_photo_4", "property_photo_5",
]);

function brandedBody(data, photoCount) {
  const rows = Object.entries(data)
    .filter(([key, value]) => !OMITTED_FIELDS.has(key) && !key.startsWith("property_photo_") && stringValue(value))
    .map(([key, value]) => `<tr><td style="padding:8px 12px;border-bottom:1px solid #e8e1d7;color:#6b7280;width:34%;vertical-align:top;">${escapeHtml(humanLabel(key))}</td><td style="padding:8px 12px;border-bottom:1px solid #e8e1d7;color:#1b2b4b;vertical-align:top;">${escapeHtml(stringValue(value))}</td></tr>`)
    .join("");

  return `<!doctype html><html><body style="margin:0;background:#f5f1ea;font-family:Arial,Helvetica,sans-serif;color:#1b2b4b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f1ea;padding:24px 12px;"><tr><td align="center">
    <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;background:#ffffff;border:1px solid #e3d9ca;">
      <tr><td style="background:#1b2b4b;padding:24px 28px;color:#faf7f2;"><div style="font-size:24px;letter-spacing:2px;font-weight:700;">ELEVIA STAYS</div><div style="margin-top:5px;color:#c9a84c;font-size:12px;letter-spacing:1.5px;">NEW INQUIRY</div></td></tr>
      <tr><td style="padding:26px 28px 12px;"><h1 style="margin:0;font-size:22px;font-weight:600;color:#1b2b4b;">${escapeHtml(displayLeadType(data.lead_type))}</h1><p style="margin:8px 0 0;color:#6b7280;font-size:14px;">Received from ${escapeHtml(data.name || "Website visitor")}${photoCount ? ` with ${photoCount} attached photo${photoCount === 1 ? "" : "s"}` : ""}.</p></td></tr>
      <tr><td style="padding:10px 28px 28px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e8e1d7;border-bottom:0;">${rows}</table></td></tr>
      <tr><td style="background:#faf7f2;padding:18px 28px;border-top:1px solid #e8e1d7;color:#6b7280;font-size:12px;">Elevia Stays &nbsp;•&nbsp; Built to Inspire.</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

async function sendIntakeEmail(data, attachments) {
  const mailbox = env("INTAKE_MAILBOX") || "hello@eleviastays.com";
  const token = await graphToken();
  const type = displayLeadType(data.lead_type);
  const subjectParts = ["[Elevia Intake]", type, data.name, data.market || data.destination_market]
    .filter(Boolean);

  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject: subjectParts.join(" — "),
        body: { contentType: "HTML", content: brandedBody(data, attachments.length) },
        toRecipients: [{ emailAddress: { address: mailbox } }],
        replyTo: data.email ? [{ emailAddress: { address: data.email, name: data.name || data.email } }] : [],
        attachments,
      },
      saveToSentItems: true,
    }),
  });
  if (!response.ok) throw new Error(`Microsoft sendMail failed (${response.status}).`);
}

export async function processSubmissionData(data) {
  if (!data.email || !data.lead_type) throw new Error("Submission is missing required fields");

  const photoUrls = extractPhotoUrls(data);
  const attachments = await Promise.all(photoUrls.map(downloadPhoto));
  await sendIntakeEmail(data, attachments);
  return { photo_count: attachments.length };
}

export default async function handler(request) {
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });

  const rawBody = await request.text();
  const secret = env("NETLIFY_WEBHOOK_SECRET");
  const signature = request.headers.get("x-webhook-signature") || "";
  if (!verifyNetlifySignature(rawBody, signature, secret)) return json(401, { error: "Invalid webhook signature" });

  try {
    const payload = JSON.parse(rawBody);
    const result = await processSubmissionData(submissionData(payload));
    return json(200, { ok: true, ...result });
  } catch (error) {
    console.error("Inquiry intake failed", error);
    return json(500, { error: "Inquiry intake failed" });
  }
}

export const config = {
  path: "/api/inquiry-intake",
  method: "POST",
};
