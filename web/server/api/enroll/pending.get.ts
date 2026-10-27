import { listPendingEnrollments } from "../../utils/ticketStore";

// S1: operator-only. Lists pending enrollment requests for the approval UI.
export default defineEventHandler(async (_event) => {
  return listPendingEnrollments().map(({ token: _token, ...rest }) => rest);
});
