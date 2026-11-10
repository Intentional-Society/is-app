// Turns a failed message-box API response into text for the person using it.
// Shared by the program page and the admin archive list, so both report the
// same failure the same way.

// A 404 on an admin message action (archive, restore, delete): the message is not
// where the action expected it. The admin routes don't depend on the box being
// on, so this is about the message: another admin removed it, restored it, or it
// was already deleted. (Permanent delete also 404s on a message that is no longer
// archived.)
export const MESSAGE_GONE = "That message was already removed or restored by someone else.";

// A 404 when an author saves an edit. Here the API answers "message gone" and
// "box turned off or program archived" the same way, so the text covers both.
export const MESSAGE_UNAVAILABLE =
  "That message is no longer available. It may have been removed, or the message box may have been turned off.";

// `notFound` is what a 404 means for the call: for a message action it is
// usually "that message is gone" (MESSAGE_GONE); for the box itself it is that
// the feature is off or the program archived (the default).
export const errorFrom = async (
  res: Response,
  fallback: string,
  notFound = "The message box isn't available right now.",
): Promise<string> => {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (body.error === "not_participant") return "Only participants of this program can leave a message.";
  if (body.error === "not_found") return notFound;
  return body.error ?? fallback;
};
