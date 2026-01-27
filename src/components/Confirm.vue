<script lang="ts">
import { Modal } from "ant-design-vue";
import { h } from "vue";
import { ref } from "vue";
import type { PropType } from "vue";

export default {
  props: {
    title: String,
    description: String,
    onConfirm: {
      type: Function as PropType<
        (payload: any, e: MouseEvent) => Promise<void>
      >,
      required: true,
    },
  },
  setup(props, ctx) {
    const visible = ref(false);
    const payload = ref();
    const loading = ref(false);
    return () => [
      h(
        Modal,
        {
          ...props,
          open: visible.value,
          "onUpdate:open": (val) => (visible.value = val),
          closable: true,
          maskClosable: false,
          async onOk(e) {
            loading.value = true;
            await props.onConfirm(payload.value, e);
            loading.value = false;
            visible.value = false;
          },
          onCancel: () => (visible.value = false),
          onClose: () => (visible.value = false),
          trigger: [""],
          okButtonProps: {
            loading: loading.value,
          },
        },
        [props.description],
      ),
      ctx.slots.default?.({
        confirm: (ps: any) => {
          payload.value = ps;
          visible.value = true;
        },
      }),
    ];
  },
};
</script>
