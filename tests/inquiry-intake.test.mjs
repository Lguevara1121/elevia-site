import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { extractPhotoUrls, verifyNetlifySignature } from "../netlify/functions/inquiry-intake.mjs";
import staysHandler, { config as staysConfig } from "../stays-site/netlify/functions/inquiry-intake.mjs";

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

test("extractPhotoUrls accepts Netlify file objects and direct URLs", () => {
  assert.deepEqual(extractPhotoUrls({
    property_photo_1: { url: "https://d33wubrfki0l68.cloudfront.net/one.jpg" },
    property_photo_2: "https://d33wubrfki0l68.cloudfront.net/two.jpg",
    property_photo_3: "",
  }), [
    { field: "property_photo_1", url: "https://d33wubrfki0l68.cloudfront.net/one.jpg" },
    { field: "property_photo_2", url: "https://d33wubrfki0l68.cloudfront.net/two.jpg" },
  ]);
});

test("verifyNetlifySignature validates the signed body hash", () => {
  const body = JSON.stringify({ data: { email: "test@example.com" } });
  const secret = "test-secret";
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: "netlify",
    sha256: crypto.createHash("sha256").update(body).digest("hex"),
  }));
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");

  assert.equal(verifyNetlifySignature(body, `${header}.${payload}.${signature}`, secret), true);
  assert.equal(verifyNetlifySignature(`${body} `, `${header}.${payload}.${signature}`, secret), false);
});

test("the standalone Stays site exports the shared intake function", () => {
  assert.equal(typeof staysHandler, "function");
  assert.equal(staysConfig.path, "/api/inquiry-intake");
});
