"use client";

import { useState } from "react";

import { ForgotPasswordForm, SigninForm } from "./signin-form";

export function SigninOrReset() {
  const [mode, setMode] = useState<"signin" | "reset">("signin");

  return (
    <>
      {mode === "signin" ? <SigninForm /> : <ForgotPasswordForm />}
      <p className="text-base text-muted-foreground">
        {mode === "signin" ? (
          <button
            type="button"
            onClick={() => setMode("reset")}
            className="underline text-muted-foreground hover:text-foreground"
          >
            Forgot password?
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setMode("signin")}
            className="underline text-muted-foreground hover:text-foreground"
          >
            Back to sign in
          </button>
        )}
      </p>
    </>
  );
}
