import { listSystems } from "../utils/metricsStore";

// S1: operator-only (enforced by middleware). Name kept as-is (`sytems`) to
// avoid breaking existing dashboard fetches; rename is out of scope for S1.
export default defineEventHandler(async (_event) => {
  return listSystems();
});
