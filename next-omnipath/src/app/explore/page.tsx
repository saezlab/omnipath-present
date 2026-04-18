"use client";

import dynamic from "next/dynamic";

const ExplorePage = dynamic(() => import("@/features/explore/page"), {
  ssr: false,
});

export default function Page() {
  return <ExplorePage />;
}
