// Code registry of program features (docs/design-programs.md, "Definition and
// attachment"). The registry is static and holds no components, so importing
// it from client code ships no feature code. Which programs have which
// features is data: the `program_features` table.

export const MESSAGE_BOX_FEATURE = "message-box";

export type ProgramFeatureDefinition = {
  key: string;
  name: string;
  description: string;
};

export const PROGRAM_FEATURES: readonly ProgramFeatureDefinition[] = [
  {
    key: MESSAGE_BOX_FEATURE,
    name: "Message box",
    description: "Participants leave short messages on the program page. Admins choose who can read them.",
  },
];

export const isProgramFeatureKey = (key: unknown): key is string =>
  typeof key === "string" && PROGRAM_FEATURES.some((f) => f.key === key);

export const MESSAGE_BOX_VISIBILITIES = ["members", "admins"] as const;
export type MessageBoxVisibility = (typeof MESSAGE_BOX_VISIBILITIES)[number];
export const MESSAGE_BOX_MAX_LENGTH = 1000;
export const MESSAGE_BOX_MAX_PROMPT_LENGTH = 2000;
