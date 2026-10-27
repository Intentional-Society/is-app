import type { Metadata } from "next";

import { LegalPage } from "@/components/legal-page";
import { titleFor } from "@/lib/page-titles";

// Public page — opt back in to indexing (root layout is noindex by default).
export const metadata: Metadata = { title: titleFor("/privacy"), robots: { index: true, follow: true } };

// Privacy policy (issue #196). FIRST DRAFT — not reviewed by the org or by
// counsel. Bump UPDATED_AT whenever the text changes.
//
// Open questions before this ships:
// - Contact address: devteam@ is a stand-in; a privacy@ or hello@ alias
//   would be better.
// - Full deletion: today only an admin can hard-delete an account
//   (deleteMemberAccount). Confirm the "ask us and we'll delete it" promise
//   and a turnaround we can keep.
// - Backups: Supabase backup retention depends on plan; confirm the
//   "rolls out of backups within N days" figure.
//
// Washington's "protecting children online" bills (SB 5708, HB 1834,
// SB 6111) had not passed as of 2026-10-26; revisit the age section if
// one becomes law.
const UPDATED_AT = new Date("2026-10-26T00:00:00Z");

const BODY = `
## The short version

- We collect what the app needs to help members find and know each other, and nothing for advertising.
- Your profile is visible to other signed-in members. Your emergency contact is visible only to you and the app's admins.
- We never sell your information or share it with advertisers.
- You can change or remove most of what you've shared yourself, any time, in the app. For anything you can't, write to us.

The rest of this page is the longer version.

## Who we are

The IS Web App is the members' app of Intentional Society, a small, globally distributed network of people who care about living intentionally, together. It is operated by Intentional Society, LLC, a limited liability company registered in Washington State, USA, and built and run by a volunteer team. When this page says "we," it means Intentional Society, LLC and the people who run the app on its behalf.

This policy covers the app at app.intentionalsociety.org. The public website at intentionalsociety.org has its own practices.

## What we collect, and why

**Your account details,** such as your name and email address, so you can sign in and we can reach you.

**What you choose to share,** such as your profile, your connections with other members, the people you invite, and the programs you join. Helping members find and know each other is what the app is for. Share what you're comfortable sharing.

**How the app is used,** such as when you sign in and reports of errors, so we can keep the app working.

## Who can see what

The app is a private space for members. What you share there, from your profile to your connections, is visible only to other signed-in members, so they can get to know you. Nothing you add is public on the open web.

Certain information is further restricted. Your emergency contact, for example, is seen only by you and the app's admins.

The admins are a small group who can see everything stored in the app, and they use that access only to run it and help members.

## Services we rely on

We use a few trusted services to run the app: Supabase (data storage), Vercel (hosting), Resend (sign-in emails), Buttondown (newsletters), Sentry (error tracking), and Axiom (logging). Each one handles your information only to provide its service to us.

We will never sell your personal information or share it with advertisers. We share information with anyone else only if the law requires it, and we'd tell you if we could.

## Cookies and browser storage

The app sets a cookie to keep you signed in, and stores a few preferences (such as light or dark theme) in your browser. We use no advertising or cross-site tracking cookies.

## How long we keep things

We keep your information while you're a member.

**If you deactivate your account,** other members can no longer see you and you stop receiving program emails. We keep your information so that you can come back.

**If you want everything deleted,** write to us and we'll delete your account and what you've shared within 30 days. The record of how the network grew, such as who invited whom, stays with your name removed. Deleted data rolls out of our backups within a few weeks.

## Your choices and rights

You can see and change most of your information yourself in the app. You can also ask us to:

- send you a copy of everything we hold about you
- correct something you can't edit yourself
- delete your account and information
- stop using your information for a particular purpose

Write to us and we'll respond within 30 days. We may ask you to confirm the request comes from you. If you're in the EU or UK and feel we haven't handled your information well, you have the right to raise a concern with your local data protection authority. We'd appreciate the chance to put it right first.

## Minimum age

You must be 16 or older to use the app, in line with COPPA (US) and GDPR Article 8 (EU). If we learn a member is under 16, we'll delete their account.

## Changes to this policy

As the app grows, this policy will change. When it changes in a way that matters, we'll tell members in the app or by email before the change takes effect. The date at the top of this page shows the last update.

## Questions

Write to the dev team at [devteam@mail.intentionalsociety.org](mailto:devteam@mail.intentionalsociety.org). A person will read it.
`;

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      updatedAt={UPDATED_AT}
      body={BODY}
      other={{ href: "/terms", label: "terms of use" }}
    />
  );
}
