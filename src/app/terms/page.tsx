import type { Metadata } from "next";

import { LegalPage } from "@/components/legal-page";
import { titleFor } from "@/lib/page-titles";

// Public page — opt back in to indexing (root layout is noindex by default).
export const metadata: Metadata = { title: titleFor("/terms"), robots: { index: true, follow: true } };

// Terms of use (issue #196). DRAFT — not reviewed by the org or by counsel.
// Bump UPDATED_AT whenever the text changes. Human-facing sections come
// first; "The legal stuff" at the end carries the boilerplate.
//
// Open questions before this ships:
// - Age: members aged 16–17 may be able to void a contract. Require 18, or
//   add a parent-or-guardian clause for under-18s?
// - Venue: "Disputes" names Washington State courts but no county.
// - One account per person: confirm it is policy.
// - "Leaving, and being asked to leave": who decides removal (admins? a
//   council?), and is there an appeal path?
// - Ownership: the repo has no license and volunteers wrote the code.
//   Confirm the "Intentional Society, LLC and its contributors" wording, or
//   settle code ownership first.
// - Shutdown notice: "a chance to get a copy of their information" means
//   fulfilling copy requests for every member at once; we have no export yet.
// - Liability cap ($100) and indemnity: both need a lawyer's read.
const UPDATED_AT = new Date("2026-11-09T00:00:00Z");

const BODY = `
## The short version

- The IS Web App is a private space for members of Intentional Society, joined by invitation.
- What you share is yours. You give us permission to show it to other members, and that's all.
- Treat other members, and what they share with you, with the same care you'd want.
- You can leave at any time.
- If you have a dispute with us, you agree to bring it to us before taking legal action.
- A volunteer team builds the app. We'll do our best to keep it running well, and we can't promise it will be perfect.

## What this is

These terms are the agreement between you and Intentional Society, LLC, a limited liability company registered in Washington State, USA, for using the app at app.intentionalsociety.org. By signing up, you agree to them. They sit alongside the community agreements you accept when you join, which describe how we hope to be with each other. These terms cover the app itself.

## Joining

The app is invitation-only, and you must be 16 or older to join (the [privacy policy](/privacy) explains why). Each account is for one person, under your own name or a name other members know you by.

If you invite someone, you vouch for them. Invite only people you know and would welcome into the community.

You're responsible for keeping your sign-in details secure, and for what happens under your account. If you think someone else has got into it, tell us right away.

## What you share

Everything you add to the app is yours. By adding them to the app, you give Intentional Society permission to store them and show them to other members, so the app can do its job. We won't use them for anything else, and we'll never sell them. Our [privacy policy](/privacy) explains who sees what, and what happens to it if you leave.

Share only what you're comfortable with other members seeing. Don't share other people's stories or details without their permission; they belong to them.

## Caring for each other

Members trust each other with personal things here. You agree to:

- hold what you learn about other members in confidence, and not share it outside the app without their consent
- keep member information inside the community: don't copy the directory or anyone's details for other uses, such as mailing lists, sales, or recruiting
- reach out to members as a person, never with spam or sales pitches
- never harass, threaten, or deceive anyone
- leave the app's workings alone: no probing for weaknesses, scraping, or using it in ways it wasn't built for. If you find a security problem, tell us, and we'll thank you.

## Programs

The app helps members find each other and take part in programs together; what happens between members is your own responsibility. Nothing in the app is therapy, medical advice, or a substitute for professional care.

## Leaving, and being asked to leave

You can leave at any time. The [privacy policy](/privacy) explains how, and what happens to your information when you do.

If a member seriously or repeatedly breaks these terms or the community agreements, we may suspend or remove their account. We'll do that with care, and wherever we can, we'll talk with them first.

## If something goes wrong, talk to us first

If you have a dispute with us about the app or these terms, you agree to write to us first, saying what happened and what you're asking for, and to give us 60 days to resolve it with you before starting any legal action. We'll work on it with you in good faith during that time, and any legal deadlines pause until it ends.

## Changes to these terms

As the app and the community grow, these terms will change. When a change matters, we'll tell members in the app or by email before it takes effect. If you keep using the app after that, you're agreeing to the new terms. If you don't agree, you can close your account.

## Questions

Write to the dev team at [devteam@mail.intentionalsociety.org](mailto:devteam@mail.intentionalsociety.org).

## The legal stuff

The rest of these terms is the formal part. It's written as plainly as we could manage, except where the law asks for capital letters.

### The app is a work in progress

A small volunteer team builds and runs the app, and it changes often. We work to keep it available and your information safe, and we can't guarantee it will always be available, error-free, or suited to every purpose. The app is offered as it is.

We may change, pause, or stop offering any part of the app at any time. If we decide to shut the app down, we'll give members reasonable notice and a chance to get a copy of their information first.

### Who owns what

What you add stays yours, as described under "What you share." The app itself, including its name, design, and code, belongs to Intentional Society, LLC and its contributors.

### Links to other sites

The app may include links to other websites. Those sites aren't ours, and we're not responsible for them.

### If your actions lead to a claim against us

If you break these terms or the law, and someone else brings a claim against Intentional Society, LLC or its volunteers because of it, you agree to cover the costs that result, including reasonable legal fees. We'll tell you about any such claim and give you the chance to help respond to it.

### Disputes

These terms are governed by the laws of the State of Washington, USA. If a dispute isn't resolved by talking it through (see "If something goes wrong, talk to us first"), it will be decided in the state or federal courts located in Washington State. If you live somewhere whose consumer laws give you more protection, nothing here takes that away.

### How these terms fit together

These terms, the [privacy policy](/privacy), and the community agreements are the whole agreement between you and Intentional Society about the app. If a court finds part of these terms unenforceable, the rest still applies. If we don't enforce part of these terms at some point, we can still enforce it later. You can't transfer your account or these terms to anyone else. Intentional Society can transfer them to an organization that takes over running the app, such as a successor nonprofit, and these terms will continue to apply. The parts of these terms that by their nature should outlast your membership, such as "Who owns what," this section, and the fine print, still apply after you leave.

### The fine print

Legal tradition holds that the next part is written in capital letters.

THE APP IS PROVIDED "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. TO THE FULLEST EXTENT PERMITTED BY LAW, INTENTIONAL SOCIETY, LLC AND ITS VOLUNTEERS AND CONTRIBUTORS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF DATA, ARISING OUT OF OR RELATING TO YOUR USE OF, OR INABILITY TO USE, THE APP, AND THEIR TOTAL LIABILITY FOR ANY CLAIM RELATING TO THE APP WILL NOT EXCEED ONE HUNDRED U.S. DOLLARS (US$100). SOME JURISDICTIONS DO NOT ALLOW THE EXCLUSION OF CERTAIN WARRANTIES OR THE LIMITATION OF CERTAIN DAMAGES, SO SOME OF THE ABOVE LIMITATIONS MAY NOT APPLY TO YOU.
`;

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of use"
      updatedAt={UPDATED_AT}
      body={BODY}
      other={{ href: "/privacy", label: "privacy policy" }}
    />
  );
}
