<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.65"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path
      v-for="(path, index) in paths[name] || paths.app"
      :key="index"
      :d="path"
    />
  </svg>
</template>

<script setup>
defineProps({ name: { type: String, default: 'app' } })
const paths = {
  phone: ['M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z', 'M10 5h4 M11 19h2'],
  app: [
    'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2',
    'M8 8h8v8H8z',
  ],
  folder: ['M2 7V5a2 2 0 0 1 2-2h6l2 3h8a2 2 0 0 1 2 2v11H2V7z', 'M2 9h20'],
  start: ['M3 3h8v8H3z M13 3h8v8h-8z M3 13h8v8H3z M13 13h8v8h-8z'],
  search: ['M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15', 'm16 16 5 5'],
  lock: ['M6 11h12v10H6z M8 11V7a4 4 0 0 1 8 0v4'],
  unlock: ['M6 11h12v10H6z M8 11V7a4 4 0 0 1 7-2'],
  close: ['m6 6 12 12 M18 6 6 18'],
  minimize: ['M5 12h14'],
  expand: ['M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5'],
  restore: ['M8 7V3h13v13h-4 M3 8h13v13H3z'],
  wifi: [
    'M2 8a16 16 0 0 1 20 0 M5 12a11 11 0 0 1 14 0 M8.5 16a5.5 5.5 0 0 1 7 0 M12 20h.01',
  ],
  bluetooth: ['M12 2v20l7-5-14-10 M5 17 19 7l-7-5'],
  airplane: ['m22 2-7 20-4-9-9-4 20-7 M11 13 22 2'],
  power: ['M12 2v9 M7 5a9 9 0 1 0 10 0'],
  battery: ['M3 6h15v12H3z M21 10v4 M6 9h9v6H6z'],
  moon: ['M20.5 13a9 9 0 1 1-9.5-9.5A7 7 0 0 0 20.5 13'],
  sun: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 19 19 M5 19l1.5-1.5 M17.5 6.5 19 5',
  ],
  volume: ['M11 4 6 8H2v8h4l5 4V4 M15 8a6 6 0 0 1 0 8 M18 5a10 10 0 0 1 0 14'],
  mute: ['M11 4 6 8H2v8h4l5 4V4 M16 9l6 6 M22 9l-6 6'],
  settings: [
    'm9 3 1-1h4l1 3 3 1 3-1 2 4-2 2v3l2 2-2 4-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-4 2-2v-3L1 9l2-4 3 1 3-1z',
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  ],
  bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4'],
  wallpaper: ['M3 3h18v18H3z M3 17l6-7 5 5 3-3 4 5 M16 6h.01'],
  chevron: ['m9 5 7 7-7 7'],
  chevronUp: ['m6 15 6-6 6 6'],
  chevronDown: ['m6 9 6 6 6-6'],
  refresh: [
    'M20 7v5h-5 M4 17v-5h5 M19 10a7 7 0 0 0-12-5L4 8 M5 14a7 7 0 0 0 12 5l3-3',
  ],
  grid: ['M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z'],
  monitor: ['M2 3h20v14H2z M8 22h8 M12 17v5'],
  media: [
    'M9 19V5l12-3v14 M9 8l12-3 M5 16a4 3 0 1 0 0 6 4 3 0 0 0 0-6 M17 13a4 3 0 1 0 0 6 4 3 0 0 0 0-6',
  ],
  pause: ['M8 5v14 M16 5v14'],
  cellular: ['M5 3v18 M2 6l3-3 3 3 M19 21V3 M16 18l3 3 3-3'],
  location: ['M12 22s8-8 8-14A8 8 0 0 0 4 8c0 6 8 14 8 14', 'M12 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6'],
  rotation: ['M5 9a8 8 0 1 1 1 9 M2 8h5v5', 'M9 10h6v8H9z M10 10V8a2 2 0 0 1 4 0v2'],
  hotspot: ['M8 8a6 6 0 0 1 8 0 M5 5a10 10 0 0 1 14 0 M10 11a3 3 0 0 1 4 0 M12 14v7 M8 21h8'],
  flashlight: ['M7 2h10v5l-3 5v10h-4V12L7 7V2z M7 6h10 M11 14h2'],
  translate: ['M2 5h12 M8 2v3 M4 8c2 4 4 6 8 8 M12 5c-1 6-4 10-10 13 M14 22l4-12 4 12 M15 18h6'],
  captions: ['M3 5h18v14H3z M6 9h12 M6 13h12 M6 16h6'],
  charge: ['M12 2 5 13h6l-1 9 9-13h-7l1-7'],
  headphones: ['M4 13V9a8 8 0 0 1 16 0v4 M2 12h5v9H2z M17 12h5v9h-5z'],
  cast: ['M2 8V3h20v17H11 M2 13a9 9 0 0 1 9 9 M2 18a4 4 0 0 1 4 4 M2 22h.01'],
  play: ['m9 5 11 7-11 7V5'],
  previous: ['M5 5v14 M19 5 8 12l11 7V5'],
  next: ['M19 5v14 M5 5l11 7-11 7V5'],
  back: ['m14 5-7 7 7 7'],
}
</script>
