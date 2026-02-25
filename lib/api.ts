export async function fetchEthUsdPrice(): Promise<number> {
  // simple example using Coingecko's public price endpoint
  const res = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
  );
  if (!res.ok) {
    throw new Error(`coingecko request failed: ${res.status}`);
  }
  const json = await res.json();
  return Number(json.ethereum.usd);
}
