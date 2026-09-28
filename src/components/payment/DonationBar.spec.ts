// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

const mocks = vi.hoisted(() => ({ openDonationPopup: vi.fn(), warning: vi.fn() }));
vi.mock("@stores/pinia/stage", () => ({
  useStageStore: () => ({ openDonationPopup: mocks.openDonationPopup }),
}));
vi.mock("ant-design-vue", () => ({ message: { warning: mocks.warning } }));

import DonationBar from "./DonationBar.vue";

const donate = (wrapper: ReturnType<typeof mount>) =>
  wrapper.find("button.is-primary").trigger("click");

beforeEach(() => {
  mocks.openDonationPopup.mockReset();
  mocks.warning.mockReset();
});

describe("DonationBar", () => {
  it("asks for an amount first", async () => {
    const wrapper = mount(DonationBar);
    await donate(wrapper);
    expect(mocks.warning).toHaveBeenCalledWith("Please select amount to donate!");
    expect(mocks.openDonationPopup).not.toHaveBeenCalled();
  });

  it("opens the donation popup with the chosen amount and clears it", async () => {
    const wrapper = mount(DonationBar);
    await wrapper.findAll("button.payment-button")[1].trigger("click");
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("20");
    await donate(wrapper);
    expect(mocks.openDonationPopup).toHaveBeenCalledWith({
      isActive: true,
      type: "Donation",
      amount: 20,
      title: "Donate to UpStage (amounts shown in US dollars)",
    });
    await donate(wrapper);
    expect(mocks.warning).toHaveBeenCalledTimes(1);
  });

  it("rounds a custom amount to cents and caps it", async () => {
    const wrapper = mount(DonationBar);
    const input = wrapper.find("input");
    (input.element as HTMLInputElement).type = "text";
    await input.setValue("12.345");
    await donate(wrapper);
    expect(mocks.openDonationPopup.mock.calls[0][0].amount).toBe(12.35);

    await input.setValue("99999999");
    await donate(wrapper);
    expect(mocks.openDonationPopup.mock.calls[1][0].amount).toBe(999999.99);
  });
});
