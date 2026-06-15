"use client";
import dynamic from "next/dynamic";

const LibraryGame = dynamic(() => import("@/components/LibraryGame"), { ssr: false });

export default function Page() {
  return (
    <main className="w-full h-screen overflow-hidden bg-black">
      <LibraryGame />
    </main>
  );
}
