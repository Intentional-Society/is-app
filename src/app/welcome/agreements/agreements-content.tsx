// Static, in-repo agreements content. Editing the wording is a deploy.
// AGREEMENTS_UPDATED_AT records when the text last changed; it is
// defined here for a future version-gate (re-prompting members after a
// revision) that is intentionally not wired up yet. See
// docs/design-welcome.md. Bump the constant whenever the text below
// changes so the version-gate has the right value to compare against
// once it is enabled.
export const AGREEMENTS_UPDATED_AT = new Date("2026-05-19T00:00:00Z");

const INTENTIONS = [
  "I intend to be who I want to be and do things I value.",
  "I intend to notice, name, and welcome what’s “alive” for me internally and relationally.",
  "I intend to contribute to the wellbeing of others around me.",
];

const INTERACTION_AGREEMENTS: { category: string; items: { title: string; body: string }[] }[] = [
  {
    category: "Safety",
    items: [
      {
        title: "Care for yourself first",
        body: "Prioritize your own physical and psychological needs over most group needs. It’s actually best for the group when we can trust that each person is taking care of themselves.",
      },
      {
        title: "Hold confidences",
        body: "Don’t share (without consent) someone else’s story or info outside of the context in which it was shared. You can share your own story while still respecting others’ privacy.",
      },
      {
        title: "Ask freely, say no freely",
        body: "When in doubt, you are encouraged to ask. Our invitations carry no obligation; it is always okay to say no.",
      },
      {
        title: "Hold on to meta-safety",
        body: "It is okay to feel unsafe. We encourage sharing that as soon as possible, even if that feels like an interruption.",
      },
    ],
  },
  {
    category: "Awareness",
    items: [
      {
        title: "Listen to your body",
        body: "Your body may sense or signal something differently than your intellect. Be open to the wisdom in its signs.",
      },
      {
        title: "Notice your feelings",
        body: "Notice that you have emotions and feelings, and your relationship (loose or tight, inside or outside) to them.",
      },
      {
        title: "Mind your perspective",
        body: "We are always inside our own perspective. Your experience can differ from someone else’s, and neither is objective or global truth. Own your own perspective, and allow space for others.",
      },
      {
        title: "Look for polarities",
        body: "Good things can be in tension with each other. Look for “both/and” when feeling trapped in “either/or” frames.",
      },
    ],
  },
  {
    category: "Engagement",
    items: [
      {
        title: "Be present",
        body: "Keep your camera on when you can. Attempt to minimize external distractions. Internal distractions can be welcomed and sometimes woven into relational presence.",
      },
      {
        title: "Respect intent and impact",
        body: "Intent and impact both matter, and impact matters more to us. Try to be generous in assuming good intent. Don’t minimize or downplay the impact on yourself or others.",
      },
      {
        title: "Choose kindness",
        body: "Kindness contains both care and challenge, compassion and candor. Surface-level “niceness” or conflict avoidance is not kind.",
      },
      {
        title: "Honor boundaries",
        body: "You own your own boundaries. It’s okay to make contact with others’ boundaries, but we try not to bang on them. Don’t try to “fix” or push other people beyond what they’re inviting.",
      },
      {
        title: "Lean in and play",
        body: "We hold an attitude of openness, curiosity, and playfulness. We seek to lean in towards growth when we encounter our edges, supported in a field of secure connection.",
      },
    ],
  },
];

export function AgreementsContent({ hasProfile }: { hasProfile: boolean }) {
  return (
    <div className="flex w-full max-w-xl flex-col gap-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-4xl font-bold">Welcome to the Web</h1>
        <p className="text-base text-muted-foreground">First, what we all share: intentions and agreements</p>
        {hasProfile && (
          <p className="text-base text-muted-foreground">
            (You’ve agreed to these before, so this is just a review for you.)
          </p>
        )}
      </div>

      <section className="flex flex-col gap-3">
        <p className="text-base">
          Members of the IS relational web share these intentions of awareness, acceptance, and integrity:
        </p>
        <ul className="flex flex-col gap-3 rounded-xl bg-card p-4 font-serif italic text-base">
          {INTENTIONS.map((intention) => (
            <li key={intention}>{intention}</li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-5">
        <p className="text-base">
          We also strive to uphold these interaction agreements (v2.0 adopted July 2022) when we are together:
        </p>
        <ul className="flex flex-col gap-3">
          {INTERACTION_AGREEMENTS.map((group) => (
            <li key={group.category}>
              <details className="group rounded-xl bg-card">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-lg font-semibold [&::-webkit-details-marker]:hidden">
                  <span>{group.category}</span>
                  <svg
                    viewBox="0 0 12 12"
                    aria-hidden="true"
                    className="size-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m3 4.5 3 3 3-3" />
                  </svg>
                </summary>
                <ul className="flex flex-col gap-2 px-4 pb-4 text-sm">
                  {group.items.map((item) => (
                    <li key={item.title}>
                      <span className="font-semibold">{item.title}.</span>{" "}
                      <span className="text-muted-foreground">{item.body}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-center text-sm text-muted-foreground">
        Clicking “I agree” records your acceptance of these intentions and agreements.
      </p>
    </div>
  );
}
