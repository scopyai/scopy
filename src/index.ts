import { searchText } from "./agents/search-engine";

async function main() {
  const res = await searchText("javascript", {
    backend: "google",
  });

  console.log(res);
}

main();
