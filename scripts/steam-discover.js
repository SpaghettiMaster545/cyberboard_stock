// Lists the purchasable packages on a Steam hardware page, with live stock,
// so you can copy package ids into a "steam" watch in config.json.
//
//   npm run steam-discover -- https://store.steampowered.com/hardware/steamframe [PL]
import { config } from '../src/config.js';
import { discoverSteamPackages, checkInventory, packageDetails } from '../src/sources/steam.js';

async function main() {
  const [url = 'https://store.steampowered.com/hardware/steamframe', cc = config.steamCountry] =
    process.argv.slice(2);
  const ctx = { config, fetch: globalThis.fetch };
  const { title, packages } = await discoverSteamPackages(url, ctx);
  console.log(`${title || url} - ${packages.length} package(s), country ${cc.toUpperCase()}:\n`);
  for (const pkg of packages) {
    const [inv, det] = await Promise.all([
      checkInventory(pkg, cc.toUpperCase(), ctx),
      packageDetails(pkg, cc.toUpperCase(), ctx)
    ]);
    const price = det.price != null ? `${det.price.toFixed(2)} ${det.currency}` : '';
    console.log(
      `  ${String(pkg).padEnd(9)} ${inv.available ? 'IN STOCK ' : 'sold out '} ${det.name || '?'}  ${price}`
    );
  }
  console.log('\nExample watch:');
  console.log(
    JSON.stringify(
      { id: 'my-steam-watch', type: 'steam', name: title || 'Steam', url, country: cc.toUpperCase(), packages },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
