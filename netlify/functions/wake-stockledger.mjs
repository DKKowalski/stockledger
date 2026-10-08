const defaultHealthUrl = 'https://stockledger-dkk-api.onrender.com/health';
const requestTimeoutMs = 20_000;

function healthUrl() {
  const configuredUrl = process.env.STOCKLEDGER_HEALTH_URL?.trim() || defaultHealthUrl;
  const url = new URL(configuredUrl);

  if (url.protocol !== 'https:') {
    throw new Error('STOCKLEDGER_HEALTH_URL must use HTTPS.');
  }

  return url;
}

export async function pingStockLedger(fetchImplementation = fetch) {
  const url = healthUrl();
  const response = await fetchImplementation(url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'user-agent': 'stockledger-netlify-wake/1.0',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(requestTimeoutMs),
  });

  if (!response.ok) {
    throw new Error(`StockLedger health check returned HTTP ${response.status}.`);
  }

  console.log(`StockLedger wake request succeeded at ${new Date().toISOString()}.`);
}

export default async function wakeStockLedger() {
  try {
    await pingStockLedger();
  } catch (error) {
    console.error('StockLedger wake request failed.', error);
  }
}

export const config = {
  schedule: '*/10 * * * *',
};
