// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn(),
  push: vi.fn(),
  message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
  form: null as Record<string, unknown> | null,
}));
vi.mock("services/graphql/composable", () => ({
  useMutation: (_request: unknown, form: Record<string, unknown>) => {
    mocks.form = form;
    return { mutation: mocks.mutation, loading: ref(false) };
  },
}));
vi.mock("services/graphql", () => ({ userGraph: { createUser: vi.fn() } }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("ant-design-vue", () => ({ message: mocks.message }));
vi.mock("vue-turnstile", () => ({ default: { template: "<div class='turnstile-stub' />" } }));
vi.mock("config", () => ({
  default: { INTRO_MAX_LENGTH: 20, MODE: "Development", CLOUDFLARE_CAPTCHA_SITEKEY: undefined },
}));

import Register from "./Register.vue";

const mountRegister = () =>
  mount(Register, {
    global: {
      mocks: { $t: (key: string) => key },
      stubs: { TermsOfService: true },
    },
  });
type Wrapper = ReturnType<typeof mountRegister>;

const fill = async (wrapper: Wrapper, values: Record<string, string>) => {
  for (const [placeholder, value] of Object.entries(values)) {
    await wrapper.find(`[placeholder^="${placeholder}"]`).setValue(value);
  }
};
const complete = {
  Username: "romeo",
  Password: "verona-1597",
  "Confirm Password": "verona-1597",
  Email: "romeo@example.org",
  "Please say briefly": "I am Romeo.",
};
const submit = async (wrapper: Wrapper) => {
  await wrapper.find("form").trigger("submit");
  await flushPromises();
};

beforeEach(() => {
  mocks.mutation.mockReset();
  mocks.push.mockReset();
  Object.values(mocks.message).forEach((fn) => fn.mockReset());
});

describe("Register", () => {
  it("does not submit an incomplete form and shows what is required", async () => {
    const wrapper = mountRegister();
    await submit(wrapper);
    expect(mocks.mutation).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Username is required");
    expect(wrapper.text()).toContain("Email is required");
    expect(wrapper.find(".turnstile-stub").exists()).toBe(false);
  });

  it("rejects short or mismatching passwords", async () => {
    const wrapper = mountRegister();
    await fill(wrapper, { ...complete, Password: "short", "Confirm Password": "short" });
    await wrapper.find("input[type=checkbox]").setValue(true);
    await submit(wrapper);
    await fill(wrapper, { Password: "verona-1597", "Confirm Password": "verona-1598" });
    await submit(wrapper);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("requires agreement to the terms", async () => {
    const wrapper = mountRegister();
    await fill(wrapper, complete);
    await submit(wrapper);
    expect(mocks.message.error).toHaveBeenCalledWith("Please agree to the Terms & Conditions");
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("registers and sends the visitor to the login page", async () => {
    mocks.mutation.mockResolvedValue({});
    const wrapper = mountRegister();
    await fill(wrapper, complete);
    await wrapper.find("input[type=checkbox]").setValue(true);
    await submit(wrapper);
    expect(mocks.mutation).toHaveBeenCalledTimes(1);
    expect(mocks.form).toMatchObject({
      username: "romeo",
      password: "verona-1597",
      email: "romeo@example.org",
      intro: "I am Romeo.",
      token: null,
    });
    expect(mocks.message.success).toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith("/login");
  });

  it("names the duplicate when the backend rejects the account", async () => {
    const wrapper = mountRegister();
    await fill(wrapper, complete);
    await wrapper.find("input[type=checkbox]").setValue(true);

    mocks.mutation.mockRejectedValueOnce('duplicate key "upstage_user_username_key"');
    await submit(wrapper);
    expect(mocks.message.error).toHaveBeenLastCalledWith("Username romeo already exists!");

    mocks.mutation.mockRejectedValueOnce('duplicate key "upstage_user_email_key"');
    await submit(wrapper);
    expect(mocks.message.error).toHaveBeenLastCalledWith("Email romeo@example.org already exists!");
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("counts the introduction and warns once at the limit", async () => {
    const wrapper = mountRegister();
    expect(wrapper.text()).toContain("Maximum 20 characters.");
    await fill(wrapper, { "Please say briefly": "12345" });
    expect(wrapper.text()).toContain("5 / 20 characters");
    await fill(wrapper, { "Please say briefly": "x".repeat(20) });
    expect(wrapper.text()).toContain("Character limit reached");
    expect(mocks.message.warning).toHaveBeenCalledTimes(1);
  });
});
