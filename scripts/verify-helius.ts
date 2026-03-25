import "dotenv/config";
import { getAsset, getTokenHolders, getDevWalletBalance } from "../server/clients/helius";

const apiKey = process.env.HELIUS_API_KEY;
if (!apiKey) {
  console.error("HELIUS_API_KEY not set in .env");
  process.exit(1);
}

// Use a known Bags.fm token — try fetching the feed first to get a valid mint
const TEST_MINT = process.argv[2] || "DitHyRMQiSDhn5cnKMJV2CDDt6sVCpCfNKBNnV7Lpump";

async function main() {
  console.log(`\n=== Helius DAS getAsset: ${TEST_MINT} ===\n`);

  try {
    const asset = await getAsset(apiKey!, TEST_MINT);
    console.log("name:", asset.name);
    console.log("symbol:", asset.symbol);
    console.log("jsonUri:", asset.jsonUri);
    console.log("mintAuthority:", asset.mintAuthority);
    console.log("freezeAuthority:", asset.freezeAuthority);
    console.log("authorities:", asset.authorities);
    console.log("interface:", asset.raw.interface);
    console.log("token_info.decimals:", asset.raw.token_info?.decimals);
    console.log("token_info.supply:", asset.raw.token_info?.supply);
    console.log(
      "\n--- content.metadata ---\n",
      JSON.stringify(asset.raw.content?.metadata, null, 2),
    );
    console.log(
      "\n--- content.links ---\n",
      JSON.stringify(asset.raw.content?.links, null, 2),
    );
  } catch (e) {
    console.error("getAsset FAILED:", e);
  }

  console.log(`\n=== Helius getTokenHolders: ${TEST_MINT} ===\n`);

  try {
    const holders = await getTokenHolders(apiKey!, TEST_MINT);
    console.log("totalSupply:", holders.totalSupply);
    console.log("top10Pct:", holders.top10Pct.toFixed(2) + "%");
    console.log("holders (top 5):");
    for (const h of holders.holders.slice(0, 5)) {
      console.log(`  ${h.address}: ${h.uiAmount.toLocaleString()} (${h.percentage.toFixed(2)}%)`);
    }
  } catch (e) {
    console.error("getTokenHolders FAILED:", e);
  }
}

main();
