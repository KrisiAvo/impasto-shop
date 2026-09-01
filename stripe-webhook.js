// Listens for Stripe's "checkout.session.completed" event and emails the
// buyer their wallpaper files via Resend. No npm dependencies — signature
// verification is done by hand with Node's built-in crypto module.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const FILES = {
  "monaco": "monaco.zip",
  "old-money": "old-money.zip",
  "kyoto": "kyoto.zip",
  "christ": "christ.zip",
  "paris": "paris.zip",
  "fighter": "fighter.zip",
  "fire-aesthetic": "fire-aesthetic.zip",
  "lazy-cars-co": "lazy-cars-co.zip",
  "bundle": "complete-atelier.zip"
};

function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader) return false;
  const parts = {};
  sigHeader.split(",").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    parts[pair.slice(0, idx)] = pair.slice(idx + 1);
  });
  if (!parts.t || !parts.v1) return false;

  const signedPayload = parts.t + "." + rawBody;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");

  const sigBuf = Buffer.from(parts.v1, "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

exports.handler = async function (event) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
  const rawBody = event.body;

  if (!secret || !verifyStripeSignature(rawBody, sig, secret)) {
    return { statusCode: 400, body: "Invalid signature" };
  }

  let evt;
  try {
    evt = JSON.parse(rawBody);
  } catch (e) {
    return { statusCode: 400, body: "Bad JSON" };
  }

  if (evt.type !== "checkout.session.completed") {
    return { statusCode: 200, body: "ignored" };
  }

  const session = evt.data.object;
  const email = session.customer_details && session.customer_details.email;
  const metaSlugs = (session.metadata && session.metadata.slugs) || "";
  const slugs = [...new Set(metaSlugs.split(",").map((s) => s.split(":")[0]).filter(Boolean))];

  if (!email || slugs.length === 0) {
    return { statusCode: 200, body: "nothing to send" };
  }

  const attachments = [];
  for (const slug of slugs) {
    const fname = FILES[slug];
    if (!fname) continue;
    const fpath = path.join(__dirname, "deliverables", fname);
    if (fs.existsSync(fpath)) {
      attachments.push({
        filename: fname,
        content: fs.readFileSync(fpath).toString("base64")
      });
    }
  }

  if (attachments.length === 0) {
    return { statusCode: 200, body: "no files matched" };
  }

  const fromEmail = process.env.FROM_EMAIL || "Impasto Atelier <onboarding@resend.dev>";
  const resendResp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.RESEND_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [email],
      subject: "Your Impasto wallpapers are ready",
      html:
        "<p>Thank you for your order.</p>" +
        "<p>Your wallpaper" + (attachments.length > 1 ? "s are" : " is") + " attached to this email, full resolution and ready to set as your desktop background.</p>" +
        "<p>— Impasto Atelier</p>",
      attachments
    })
  });

  if (!resendResp.ok) {
    const errText = await resendResp.text();
    console.error("Resend error:", errText);
    return { statusCode: 500, body: "Email failed to send" };
  }

  return { statusCode: 200, body: "sent" };
};
