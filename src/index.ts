import "dotenv/config";
import { research } from "./agents/agents";

async function main() {
  const res = await research(
    "what are the non-american and non-european universities that offer 100-tuition fees covering scholarships for international students?",
  );

  console.log(res);
}

main();
