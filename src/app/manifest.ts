import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sakha",
    short_name: "Sakha",
    description:
      "Sakha is a personal AI operator with modular providers, shared memory, tasks, and guarded local tools.",
    start_url: "/",
    display: "standalone",
    background_color: "#07111f",
    theme_color: "#d6ff57",
    orientation: "portrait",
    icons: [
      {
        src: "/icon-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "maskable",
      },
      {
        src: "/icon-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
