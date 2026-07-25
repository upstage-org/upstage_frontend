<script lang="ts">
import { useI18n } from "vue-i18n";
import { Button, Modal, Popconfirm, message } from "ant-design-vue";
import { h, ref } from "vue";
import { DeleteOutlined } from "@ant-design/icons-vue";
import { PropType } from "vue";
import { gql } from "@apollo/client/core";
import { useMutation } from "@vue/apollo-composable";

type ContentAction = "REASSIGN_TO_ADMIN" | "DELETE_ALL";

export default {
  props: {
    player: {
      type: Object,
      required: true,
    },
    onDone: {
      type: Function as PropType<(player: any) => Promise<void>>,
      required: true,
    },
  },
  setup(props) {
    const { t } = useI18n();

    const open = ref(false);
    const loadingAction = ref<ContentAction | null>(null);

    const { mutate: deleteUser } = useMutation<
      {
        deleteUser: { success: boolean; message: string };
      },
      { id: string; contentAction: ContentAction }
    >(gql`
      mutation DeleteUser($id: ID!, $contentAction: UserContentAction) {
        deleteUser(id: $id, contentAction: $contentAction) {
          success
          message
        }
      }
    `);

    const run = async (contentAction: ContentAction) => {
      loadingAction.value = contentAction;
      try {
        await deleteUser({ id: props.player.id, contentAction });
        open.value = false;
        await props.onDone?.(props.player);
      } catch (error) {
        message.error(error instanceof Error ? error.message : (error as string));
      } finally {
        loadingAction.value = null;
      }
    };

    const actionButton = (
      contentAction: ContentAction,
      label: string,
      extraProps: Record<string, unknown>,
      onClick?: () => void,
    ) =>
      h(
        Button,
        {
          ...extraProps,
          loading: loadingAction.value === contentAction,
          disabled: !!loadingAction.value && loadingAction.value !== contentAction,
          ...(onClick ? { onClick } : {}),
        },
        () => label,
      );

    return () => [
      h(
        Button,
        { danger: true, onClick: () => (open.value = true) },
        {
          icon: () => h(DeleteOutlined),
        },
      ),
      h(
        Modal,
        {
          open: open.value,
          title: t("delete_player_title", { name: props.player.username }),
          footer: null,
          onCancel: () => (open.value = false),
        },
        {
          default: () => [
            h("p", { style: { whiteSpace: "pre-line" } }, t("delete_player_confirm")),
            h(
              "div",
              {
                style: {
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "8px",
                  flexWrap: "wrap",
                  marginTop: "16px",
                },
              },
              [
                h(Button, { onClick: () => (open.value = false) }, () => t("cancel")),
                actionButton(
                  "REASSIGN_TO_ADMIN",
                  t("delete_player_reassign"),
                  { type: "primary" },
                  () => run("REASSIGN_TO_ADMIN"),
                ),
                h(
                  Popconfirm,
                  {
                    title: t("delete_player_no_undo"),
                    okText: t("yes"),
                    cancelText: t("no"),
                    onConfirm: () => run("DELETE_ALL"),
                  },
                  () => actionButton("DELETE_ALL", t("delete_player_delete_all"), { danger: true }),
                ),
              ],
            ),
          ],
        },
      ),
    ];
  },
};
</script>
