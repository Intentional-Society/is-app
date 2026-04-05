"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [message, setMessage] = useState("Loading...");
  const [serverTime, setServerTime] = useState("");

  useEffect(() => {
    fetch("/api/hello")
      .then((res) => res.json())
      .then((data) => setMessage(data.message))
      .catch(() => setMessage("Failed to connect to API"));

    fetch("/api/health")
      .then((res) => res.json())
      .then((data) => setServerTime(data.database.serverTime))
      .catch(() => setServerTime("Failed to connect to database"));
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold">Intentional Society</h1>
      <p className="text-lg text-gray-600">{message}</p>
      {serverTime && (
        <p className="text-sm text-gray-400">Database time: {serverTime}</p>
      )}
    </main>
  );
}
