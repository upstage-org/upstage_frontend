<template>
  <a v-if="link" class="navbar-item" :href="link" :target="target || '_self'">
    <img :src="logoSrc" />
  </a>
  <router-link v-else class="navbar-item" :to="to ?? '/'">
    <img :src="logoSrc" />
  </router-link>
</template>

<script>
// Import the asset through Vite's resolver so the rendered <img> uses an
// absolute, content-hashed URL instead of the literal string "assets/…".
// A bare-string `src` is browser-relative and resolves against the
// document URL — fine on one-segment routes like `/<slug>` (which give
// `/assets/upstage.png`), broken on deeper routes like
// `/replay/<slug>/<id>` (resolves to `/replay/<slug>/assets/upstage.png`,
// which 404s and renders as a broken-image icon in the top-left).
// `Navbar.vue` and `QRCode.vue` already use this same pattern.
import logoSrc from "assets/upstage.png";

export default {
  props: ["link", "to", "target"],
  data() {
    return { logoSrc };
  },
};
</script>
