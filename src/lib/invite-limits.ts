// Invite form limits, shared between the server-side validator and the
// client UI so the two stay in lockstep. Keep this file dependency-free
// (no db, no node APIs) so the client bundle can import it. The server
// remains the real gatekeeper — these constants only keep the client's
// pre-submit hints honest.

export const MIN_NOTE_LENGTH = 5;
export const HINTS_PER_INVITE_LIMIT = 20;
