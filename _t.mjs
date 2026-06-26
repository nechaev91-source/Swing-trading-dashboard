import { normDate } from "./js/ui.js";
for (const s of ["2026-06-18","06/18/2026","18/06/2026","6/7/2026","18.06.2026","Jun 18, 2026","2024-04-18 00:00:00","",null,"13/04/2026"])
  console.log(JSON.stringify(s), "→", JSON.stringify(normDate(s)));
