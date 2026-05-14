import {
  createRouter,
  createWebHistory,
  type NavigationGuardNext,
  type RouteLocationNormalized,
  type RouteRecordRaw,
} from "vue-router";
import { message } from "ant-design-vue";
import { useAuthStore } from "@stores/pinia/auth";
import { useUserStore } from "@stores/pinia/user";
import { UPLOAD_LIMIT_MESSAGE_KEY } from "@utils/constants";

declare module "vue-router" {
  interface RouteMeta {
    requireAuth?: boolean;
    background?: string;
  }
}

const setViewportMeta = (content: string): void => {
  const meta = document.querySelector<HTMLMetaElement>("meta[name=viewport]");
  if (meta) {
    meta.setAttribute("content", content);
  }
};

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    component: () => import("layout/UnAuthorized.vue"),
    children: [
      {
        path: "/",
        name: "Home",
        component: () => import("views/Home.vue"),
      },
      {
        path: "/login",
        name: "Login",
        component: () => import("views/Login.vue"),
      },
      {
        path: "/register",
        name: "Register",
        component: () => import("views/Register.vue"),
      },
    ],
  },
  {
    path: "/replay/:url/:id",
    name: "Replay Recording",
    component: () => import("views/replay/Layout.vue"),
  },
  {
    path: "/playground",
    name: "Playground",
    component: () => import("views/Playground.vue"),
  },
  {
    // Standalone chat view: same MQTT topic as the main stage, but
    // renders only the chat panes so mobile audience members (and
    // multi-screen performers via window.open) can participate
    // without loading the full stage UI. Must be registered BEFORE
    // the catch-all `/:url` Live route so vue-router matches
    // "/chat/<stage>" against this entry first; otherwise "chat"
    // would be interpreted as a stage slug.
    path: "/chat/:url",
    name: "ChatStandalone",
    component: () => import("views/chat/Layout.vue"),
  },
  {
    // Keep this last so static routes win.
    path: "/:url",
    name: "Live",
    component: () => import("views/live/Layout.vue"),
  },
  {
    path: "/",
    component: () => import("layout/Authorized.vue"),
    meta: { requireAuth: true },
    name: "Dashboard",
    children: [
      {
        path: "/stages",
        meta: { background: "#C7DCA7" },
        children: [
          {
            path: "",
            name: "Stages",
            component: () => import("views/stages/index.vue"),
          },
          {
            path: "new-stage",
            component: () => import("views/stages/StageManagement/index.vue"),
            name: "New Stage",
            children: [
              {
                name: "General Stage",
                path: "",
                component: () => import("views/stages/StageManagement/General.vue"),
              },
            ],
          },
          {
            path: "stage-management/:id",
            component: () => import("views/stages/StageManagement/index.vue"),
            props: (route) => ({ id: route.params.id }),
            children: [
              {
                path: "",
                name: "Stage Management",
                component: () => import("views/stages/StageManagement/General.vue"),
              },
              {
                name: "Stage Customisation",
                path: "customisation",
                component: () => import("views/stages/StageManagement/Customisation.vue"),
              },
              {
                name: "Stage Media",
                path: "media",
                component: () => import("views/stages/StageManagement/Media.vue"),
              },
              {
                name: "Archive",
                path: "archive",
                component: () => import("views/stages/StageManagement/Archive.vue"),
              },
            ],
          },
        ],
      },
      {
        path: "/media",
        name: "Media",
        component: () => import("views/media/index.vue"),
        meta: { background: "#FFEBD8" },
      },
      {
        path: "/admin",
        name: "Admin",
        component: () => import("views/admin/index.vue"),
        meta: { background: "#E6F2FF" },
        children: [
          {
            path: "player",
            component: () => import("views/admin/player-management/index.vue"),
          },
          {
            path: "configuration/:section?",
            component: () => import("views/admin/configuration/index.vue"),
          },
          {
            path: "email-notification",
            component: () => import("views/admin/email-notifications/index.vue"),
          },
        ],
      },
    ],
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(
  async (
    to: RouteLocationNormalized,
    _from: RouteLocationNormalized,
    next: NavigationGuardNext,
  ) => {
    document.body.classList.add("waiting");

    const loggedIn: boolean = useAuthStore().loggedIn;

    if (to.matched.some((record) => record.meta.requireAuth) && !loggedIn) {
      return next("/login");
    }

    if ((to.name === "Login" || to.name === "Register") && loggedIn) {
      return next("/stages");
    }

    // Clear the viewport meta only for the desktop-only Live stage,
    // which has its own zoom/pan handling. Every other route —
    // including the new ChatStandalone — gets the mobile-friendly
    // viewport so phones render at sensible scale.
    setViewportMeta(to.name === "Live" ? "" : "width=device-width,initial-scale=1.0");

    if (to.fullPath.includes("admin") && loggedIn) {
      const isAdmin = await useUserStore().checkIsAdmin();
      if (!isAdmin) {
        return next("/");
      }
    }

    if (to.meta.requireAuth && loggedIn) {
      const isGuest = await useUserStore().checkIsGuest();
      if (isGuest) {
        return next("/");
      }
    }

    return next();
  },
);

router.afterEach(() => {
  document.body.classList.remove("waiting");
  message.destroy(UPLOAD_LIMIT_MESSAGE_KEY);
});

export default router;
