import { searchText } from "./caller";

async function main() {
  const res = await searchText("javascript", {
    backend: "google",
  });

  console.log(res);
}

main();
