// Turns a failed message-box API response into text for the person using it.
// Shared by the program page and the admin archive list, so both report the
// same failure the same way.

export const MESSAGE_GONE = "That message is no longer available. It may have been removed already.";

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
