"use client";

import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api";

export default function Home() {
  const [serverTime, setServerTime] = useState("");

  useEffect(() => {
    apiClient.api.health
      .$get()
      .then((res) => res.json())
      .then((data) => setServerTime(String(data.database.serverTime)))
      .catch(() => setServerTime("Failed to connect to database"));
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold">Intentional Society</h1>
      {serverTime && (
        <p className="text-sm text-gray-400">Database time: {serverTime}</p>
      )}
    </main>
  );
}
