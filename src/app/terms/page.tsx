import type { Metadata } from "next";

import { LegalPage } from "@/components/legal-page";
import { titleFor } from "@/lib/page-titles";

// Public page — opt back in to indexing (root layout is noindex by default).
export const metadata: Metadata = { title: titleFor("/terms"), robots: { index: true, follow: true } };

// Terms of use (issue #196). FIRST DRAFT — not reviewed by the org or by
// counsel. Bump UPDATED_AT whenever the text changes.
//
// Open questions before this ships:
// - Venue: the governing-law section names Washington State but no
//   county or court for disputes.
// - One account per person: confirm it is policy.
// - "Leaving, and being asked to leave": who decides removal (admins? a
//   council?), and is there an appeal path?
// - "The app is a work in progress" and "The fine print": the
//   plain-language and all-caps warranty/liability text both need a
//   lawyer's read, including whether to add a liability cap.
const UPDATED_AT = new Date("2026-10-26T00:00:00Z");

const BODY = `
## The short version

- The IS Web App is a private space for members of Intentional Society, joined by invitation.
- What you share is yours. You give us permission to show it to other members, and that's all.
- Treat other members, and what they share with you, with the same care you'd want.
- You can leave at any time.
- A volunteer team builds the app. We'll do our best to keep it running well, and we can't promise it will be perfect.

## What this is

These terms are the agreement between you and Intentional Society, LLC, a limited liability company registered in Washington State, USA, for using the app at app.intentionalsociety.org. By signing up, you agree to them. They sit alongside the community agreements you accept when you join, which describe how we hope to be with each other. These terms cover the app itself.

## Joining

The app is invitation-only. To join, you need an invite from a current member, and you must be 16 or older (the [privacy policy](/privacy) explains why). Each account is for one person. Please use your own name or a name other members know you by.

When you invite someone, you're vouching for them. Invite people you know and would be glad to see in the community.

## What you share

Your profile, the relationships you record, and everything else you add are yours. By adding them to the app, you give Intentional Society permission to store them and show them to other members, so the app can do its job. We won't use them for anything else, and we'll never sell them. Our [privacy policy](/privacy) explains who sees what.

Please share only what you're comfortable with other members seeing, and only what's yours to share. Other people's stories and details belong to them.

## Caring for each other

Members trust each other with personal things here. In return, we ask you to:

- hold what you learn about other members in confidence, and not share it outside the app without their consent
- keep member information inside the community: don't copy the directory or anyone's details for other uses, such as mailing lists, sales, or recruiting
- reach out to members as a person, never with spam or sales pitches
- never harass, threaten, or deceive anyone
- leave the app's workings alone: no probing for weaknesses, scraping, or using it in ways it wasn't built for. If you find a security problem, tell us, and we'll thank you.

## Programs

Through the app you can join programs and connect with other members. The app helps you find each other; what happens between members is your own responsibility. Nothing in the app is therapy, medical advice, or a substitute for professional care.

## Leaving, and being asked to leave

You can deactivate your account at any time in the app, or ask us to delete it entirely (see the [privacy policy](/privacy)).

If a member seriously or repeatedly breaks these terms or the community agreements, we may suspend or remove their account. We'll do that with care, and wherever we can, we'll talk with them first.

## The app is a work in progress

A small volunteer team builds and runs the app, and it changes often. We work to keep it available and your information safe, and we can't guarantee it will always be available, error-free, or suited to every purpose. The app is offered as it is.

To the extent the law allows, Intentional Society, LLC and the people who build the app aren't liable for indirect losses that come from using it, or from being unable to use it.

## Changes to these terms

As the app and the community grow, these terms will change. When a change matters, we'll tell members in the app or by email before it takes effect. If you keep using the app after that, you're agreeing to the new terms. If you don't agree, you can close your account.

## Governing law

These terms are governed by the laws of the State of Washington, USA.

## Questions

Write to the dev team at [devteam@mail.intentionalsociety.org](mailto:devteam@mail.intentionalsociety.org).

## The fine print

Legal tradition holds that the next part must be written in capital letters. We didn't make the rule, but we'll follow it:

THE APP IS PROVIDED "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. TO THE FULLEST EXTENT PERMITTED BY LAW, INTENTIONAL SOCIETY, LLC AND ITS VOLUNTEERS AND CONTRIBUTORS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF DATA, ARISING OUT OF OR RELATING TO YOUR USE OF, OR INABILITY TO USE, THE APP. SOME JURISDICTIONS DO NOT ALLOW THE EXCLUSION OF CERTAIN WARRANTIES OR THE LIMITATION OF CERTAIN DAMAGES, SO SOME OF THE ABOVE LIMITATIONS MAY NOT APPLY TO YOU.
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
