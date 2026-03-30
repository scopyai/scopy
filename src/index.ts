import "dotenv/config";
import { research } from "./agents/agents";

async function main() {
  const res = await research(
    "what are the top asian universities that have english-taught undergraduate programs in computer science?",
  );

  console.log(res);
}

main();
