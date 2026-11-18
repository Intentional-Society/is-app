"use client";

import { ArchivedMessages } from "./message-box-archived";
import { MessageBoxSettings } from "./message-box-settings";

// Everything an admin manages for the message box on /admin/programs/[id]:
// its settings, and the messages archived from the program page.
export function MessageBoxAdmin({ programId }: { programId: string }) {
  return (
    <div className="flex flex-col gap-3">
      <MessageBoxSettings programId={programId} />
      <ArchivedMessages programId={programId} />
    </div>
  );
}
