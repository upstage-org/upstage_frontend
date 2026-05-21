import type { Directive, DirectiveBinding } from "vue";

type ClickOutsideHandler = (event: MouseEvent) => void;

interface ClickOutsideElement extends HTMLElement {
  __clickOutsideHandler__?: ClickOutsideHandler;
}

const ClickOutside: Directive<ClickOutsideElement, ClickOutsideHandler> = {
  beforeMount(el, binding: DirectiveBinding<ClickOutsideHandler>) {
    el.__clickOutsideHandler__ = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && !(el === target || el.contains(target))) {
        binding.value(event);
      }
    };
    document.addEventListener("click", el.__clickOutsideHandler__);
  },
  unmounted(el) {
    if (el.__clickOutsideHandler__) {
      document.removeEventListener("click", el.__clickOutsideHandler__);
      delete el.__clickOutsideHandler__;
    }
  },
};

export default ClickOutside;
