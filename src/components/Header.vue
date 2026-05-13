<script lang="ts">
import Navbar from "components/Navbar.vue";
import { h } from "vue";
import { Affix } from "ant-design-vue";

export default {
  setup(_, { slots }) {
    return () =>
      h(Affix, { offsetTop: 0 }, () => [
        h(
          "div",
          {
            class:
              "shadow rounded-xl px-4 py-2 bg-white flex justify-between items-center w-full",
          },
          [slots.default?.(), h(Navbar)],
        ),
      ]);
  },
};
</script>
