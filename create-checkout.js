// Creates a real Stripe Checkout Session for whatever is in the visitor's cart.
// No npm dependencies — talks to Stripe's REST API directly with fetch.

const PRICES = { // amounts in cents, EUR — server-side, never trust the client
  "monaco": 490,
  "old-money": 490,
  "kyoto": 490,
  "christ": 490,
  "paris": 490,
  "fighter": 490,
  "fire-aesthetic": 490,
  "lazy-cars-co": 490,
  "bundle": 3290
};

const NAMES = {
  "monaco": "Monaco — 5 studies",
  "old-money": "Old Money — 5 studies",
  "kyoto": "Kyoto — 5 studies",
  "christ": "Christ Collection — 5 studies",
  "paris": "Paris — 5 studies",
  "fighter": "Fighter — 4 studies",
  "fire-aesthetic": "Fire Aesthetic — 4 studies",
  "lazy-cars-co": "Lazy Cars Co — 4 studies",
  "bundle": "The Complete Atelier — all 37 studies"
};

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const SITE_URL = process.env.SITE_URL; // e.g. https://impasto-atelier.netlify.app
  if (!STRIPE_SECRET_KEY || !SITE_URL) {
    return { statusCode: 500, body: "Server is missing STRIPE_SECRET_KEY or SITE_URL env vars." };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: "Bad JSON" };
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return { statusCode: 400, body: "Cart is empty." };
  }

  const params = new URLSearchParams();
  params.append("mode", "payment");
  params.append("success_url", SITE_URL + "/success.html?session_id={CHECKOUT_SESSION_ID}");
  params.append("cancel_url", SITE_URL + "/index.html#/checkout");

  let lineIndex = 0;
  const slugQtyPairs = [];

  for (const it of items) {
    const slug = String(it.slug || "");
    const qty = Math.max(1, Math.min(20, parseInt(it.qty, 10) || 1));
    if (!PRICES[slug]) continue; // ignore anything not in our own price table

    params.append(`line_items[${lineIndex}][price_data][currency]`, "eur");
    params.append(`line_items[${lineIndex}][price_data][product_data][name]`, NAMES[slug]);
    params.append(`line_items[${lineIndex}][price_data][unit_amount]`, String(PRICES[slug]));
    params.append(`line_items[${lineIndex}][quantity]`, String(qty));
    lineIndex++;
    slugQtyPairs.push(slug + ":" + qty);
  }

  if (lineIndex === 0) {
    return { statusCode: 400, body: "No valid items in cart." };
  }

  // Stored on the session so the webhook knows what to email later.
  params.append("metadata[slugs]", slugQtyPairs.join(","));

  const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + STRIPE_SECRET_KEY,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });

  const data = await resp.json();
  if (!resp.ok) {
    return { statusCode: 500, body: JSON.stringify(data) };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: data.url })
  };
};
