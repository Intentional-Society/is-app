// Member-facing changelog: the "Changelog" section of the /about page.
//
// This is NOT docs/devjournal.md. The dev journal is an internal,
// technical log for teammates; these entries are plain-language notes
// for members about changes they can see and use. When you ship a
// member-visible feature, add an entry at the TOP (newest first) and
// translate it into a sentence a member would care about — skip the
// infra/CI/migration work that has no member-visible surface.
//
// Voice: write in the present tense and describe what is now true, not
// the work that was done. "We"/"us"/"our" must not mean the dev team —
// name it ("the dev team"); those words are fine only for the whole
// network, which includes the reader. "You" for the reader is fine.
//
// The app "version" shown on /about is just the date of the newest
// entry below (see `appVersion`).

// Loose shape check on the date literals; the test owns calendar validity.
type ISODate = `${number}-${number}-${number}`;

export type ChangelogEntry = {
  /** ISO date, "YYYY-MM-DD". */
  date: ISODate;
  /** Short, member-facing headline. */
  title: string;
  /** One or two plain-language sentences. */
  description: string;
};

// Newest first. The /about page and `appVersion` both rely on this
// ordering; a functional test asserts it stays sorted.
export const changelog: ChangelogEntry[] = [
  {
    date: "2026-06-08",
    title: "See how you're connected",
    description: "Each member's profile now shows a small relational map of the shortest paths linking you and them.",
  },
  {
    date: "2026-06-08",
    title: "Filter your Web",
    description:
      "You can now filter My Web by relationship depth — toggle the depths on or off to see different subsets.",
  },
  {
    date: "2026-06-05",
    title: "See how the network is growing",
    description: "The About page now has a System Metrics section with member and activity stats.",
  },
  {
    date: "2026-06-05",
    title: "Remove a relationship",
    description: "You can now remove relationships by setting a depth of 0.",
  },
  {
    date: "2026-06-04",
    title: "Clearer relationship labels",
    description:
      "The labels and wording for relationship depth are simpler and clearer now, refined once more for understandability.",
  },
  {
    date: "2026-05-29",
    title: "Share your current intention",
    description:
      'The "Live Desire" field is now "Current Intention", and there\'s now a basic visualization/browsing feature.',
  },
  {
    date: "2026-05-28",
    title: "Give feedback anytime",
    description:
      "There's a Give Feedback link in the menu and on the home page now. If something's off or you've got an idea, say so.",
  },
  {
    date: "2026-05-21",
    title: "Every program has its own page",
    description: "Each program has its own details page (with URL) now, for more info and the list of participants.",
  },
  {
    date: "2026-05-20",
    title: "Emails that show up",
    description:
      "Signing in, signing up, and password resets now have production-ready styled emails that land reliably.",
  },
  {
    date: "2026-05-19",
    title: "A guided welcome",
    description:
      "Joining walks you through a few steps — our shared agreements, your profile, programs, then your Web (which itself has a tour).",
  },
  {
    date: "2026-05-18",
    title: "Pre-filled profiles from earlier sign-ups",
    description: "If you signed up using the Google Form earlier, your profile is now filled in before you arrive.",
  },
  {
    date: "2026-05-16",
    title: "Profile pictures",
    description: "Add a photo to your profile and crop it to a circle, right in the app.",
  },
  {
    date: "2026-05-13",
    title: "A basic home page",
    description: "The home page is a grid of cards listing the things you can do, and it greets you by name.",
  },
  {
    date: "2026-05-09",
    title: "Your personal Web",
    description: "My Web is where you map the people you know and how you're connected to each of them.",
  },
  {
    date: "2026-05-07",
    title: "Meet the members",
    description:
      "There's a directory of everyone in the network now, each with a profile page so you can get to know people.",
  },
  {
    date: "2026-05-01",
    title: "A new look",
    description: "The app now has its first styling — colors, typography, better buttons.",
  },
  {
    date: "2026-05-01",
    title: "Browse and join programs",
    description:
      "The Programs page shows what's running, with a short description and how many people are in. Join or leave whenever you like.",
  },
  {
    date: "2026-04-30",
    title: "More to your profile",
    description:
      "Profiles hold a lot more now — a bio, keywords, location, and so on. There's a read-only view, plus an Edit mode.",
  },
  {
    date: "2026-04-20",
    title: "Invite a friend with a code",
    description: "Know someone who belongs here? Make an invite code, and they can sign up with it.",
  },
  {
    date: "2026-04-18",
    title: "The app is minimally alive",
    description:
      "Authentication is now the first functional feature. Sign in with a magic link — no password to remember.",
  },
  {
    date: "2026-04-04",
    title: "Day one",
    description: "The very first commit — some architectural design notes.",
  },
];

// The "version" shown on /about: the date of the most recent change.
export const appVersion = changelog[0]?.date ?? "";

// Format an entry's "YYYY-MM-DD" date as e.g. "May 29, 2026". Pinned to
// UTC so the rendered date matches the string regardless of the
// server's timezone.
export function formatChangelogDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
