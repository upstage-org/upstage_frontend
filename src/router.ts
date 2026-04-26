import {
  createRouter,
  createWebHistory,
  type NavigationGuardNext,
  type RouteLocationNormalized,
  type RouteRecordRaw,
} from "vue-router";
import store from "@stores/index";

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

    const loggedIn: boolean = store.getters["auth/loggedIn"];

    if (to.matched.some((record) => record.meta.requireAuth) && !loggedIn) {
      return next("/login");
    }

    if ((to.name === "Login" || to.name === "Register") && loggedIn) {
      return next("/stages");
    }

    setViewportMeta(
      to.name === "Live" ? "" : "width=device-width,initial-scale=1.0",
    );

    if (to.fullPath.includes("admin") && loggedIn) {
      const isAdmin: boolean = await store.dispatch("user/checkIsAdmin");
      if (!isAdmin) {
        return next("/");
      }
    }

    if (to.meta.requireAuth && loggedIn) {
      const isGuest: boolean = await store.dispatch("user/checkIsGuest");
      if (isGuest) {
        return next("/");
      }
    }

    return next();
  },
);

router.afterEach(() => {
  document.body.classList.remove("waiting");
});

export default router;
