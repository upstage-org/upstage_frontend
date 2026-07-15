import { useMutation } from "@vue/apollo-composable";
import { message } from "ant-design-vue";
import { gql } from "@apollo/client/core";
import { ref, computed } from "vue";
import { MEDIA_FORM_META_QUERY, MEDIA_PAGE_TOOLBAR_QUERY } from "services/graphql/mediaList";
import { permissionFragment } from "models/fragment";
import {
  AvatarVoice,
  CopyrightLevel,
  Link,
  Media,
  Permission,
  StageAssignmentValue,
  UploadFile,
} from "models/studio";

interface SaveMediaPayload {
  files: UploadFile[];
  media: SaveMediaMutationVariables;
}

interface SaveMediaMutationVariables {
  id?: string;
  name: string;
  urls: string[];
  mediaType: string;
  copyrightLevel: CopyrightLevel;
  owner: string;
  stageAssignments: StageAssignmentValue[];
  userIds: string[];
  tags: string[];
  w: number;
  h: number;
  note: string;
  voice: AvatarVoice;
  link: Link;
}

/**
 * The backend answers GraphQL errors with HTTP 400, which Apollo surfaces
 * as a generic ServerError ("Received status code 400") in `error.message`
 * — the real cause ("Stream with the same key already existed",
 * "Authenticated Failed", …) is buried in `networkError.result.errors`.
 * Dig it out so error toasts say something actionable.
 */
export function apolloErrorText(error: any): string {
  const buried =
    error?.graphQLErrors?.[0]?.message ?? error?.networkError?.result?.errors?.[0]?.message;
  if (buried) return buried;
  const text = error?.message ?? String(error);
  // Chrome aborts in-flight fetches when the machine's network changes
  // (ERR_NETWORK_CHANGED); Apollo reports that as a bare "Failed to fetch".
  return /failed to fetch/i.test(text)
    ? "Network connection interrupted — please try saving again."
    : text;
}

const getBase64 = (file: File) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = function () {
      resolve(reader.result as string);
    };
    reader.onerror = function (_error) {
      resolve("");
    };
  });

export const useSaveMedia = (
  collectData: () => SaveMediaPayload,
  handleSuccess: (id: string) => any,
) => {
  const { mutate: uploadFile } = useMutation<
    { uploadFile: { url: string } },
    { base64: string; filename: string }
  >(gql`
    mutation Upload($base64: String!, $filename: String!) {
      uploadFile(base64: $base64, filename: $filename) {
        url
      }
    }
  `);
  const { mutate } = useMutation<
    { saveMedia: { asset: Media } },
    { input: SaveMediaMutationVariables }
  >(
    gql`
      mutation SaveMedia($input: SaveMediaInput!) {
        saveMedia(input: $input) {
          asset {
            id
          }
        }
      }
    `,
    {
      refetchQueries: [MEDIA_PAGE_TOOLBAR_QUERY, MEDIA_FORM_META_QUERY],
      awaitRefetchQueries: true,
    },
  );
  const progress = ref(100);

  const saveMedia = async () => {
    try {
      progress.value = 0;
      const payload = collectData();
      const totalSteps = payload.files.length + 1;
      let finishedSteps = 0;
      const increaseProgress = () => {
        finishedSteps++;
        progress.value = Math.round((finishedSteps * 100) / totalSteps);
      };
      for (const file of payload.files) {
        if (file.status === "local") {
          const base64 = await getBase64(file.file);
          const result = await uploadFile({ base64, filename: file.file.name });
          const uploadedUrl = result?.data?.uploadFile.url;
          if (uploadedUrl) {
            file.url = uploadedUrl;
            file.status = "uploaded";
            increaseProgress();
          } else {
            message.error(`File ${file.file.name} upload failed!`);
          }
        }
      }
      payload.media.urls = payload.files
        .filter((file) => file.status !== "local")
        .map((file) => file.url!);
      const result = await mutate({ input: payload.media });
      const mediaId = result?.data?.saveMedia.asset.id;
      if (mediaId) {
        // Short-lived and click-to-dismiss: the toast sits exactly over the
        // media list's stage / media-type filter row, so it must never
        // block a user who saves and immediately reaches for the filters.
        message.success({
          content: "Media saved successfully",
          key: "media-saved",
          duration: 1.5,
          onClick: () => message.destroy("media-saved"),
        });
        handleSuccess(mediaId);
      }
    } catch (error) {
      message.error(apolloErrorText(error));
    } finally {
      progress.value = 100;
    }
  };

  const saving = computed(() => progress.value < 100);

  return { progress, saveMedia, saving };
};

export const useConfirmPermission = () => {
  return useMutation<
    {
      confirmPermission: {
        success: boolean;
        message: string;
        permissions: Permission[];
      };
    },
    { id: string; approved: boolean }
  >(
    gql`
      mutation ConfirmPermission($id: ID!, $approved: Boolean) {
        confirmPermission(id: $id, approved: $approved) {
          success
          message
          permissions {
            ...permissionFragment
          }
        }
      }
      ${permissionFragment}
    `,
    // The Notifications bell shows pending strict requests on the
    // owner side and approval results on the requester side; both
    // change shape when a confirm runs. The component already does a
    // manual `refetch()` after this mutation, but other consumers
    // (e.g. MediaPermissions in MediaForm) don't — so refetch
    // here too, so the bell stays in sync no matter where the
    // approve/reject button was pressed.
    { refetchQueries: ["Notifications"] },
  );
};

export const useRequestPermission = () => {
  return useMutation<
    { requestPermission: { success: boolean; message: string } },
    { assetId: string; note?: string }
  >(
    gql`
      mutation RequestPermission($assetId: ID!, $note: String) {
        requestPermission(assetId: $assetId, note: $note) {
          success
        }
      }
    `,
    // Strict requests don't change the *requester's* bell (they
    // initiated the request, so requester_seen is set True by the
    // backend), but acknowledgement requests on non-strict media
    // intentionally do not create a requester-side bell entry
    // either. The refetch here is the polite local-tab refresh so
    // any prior-state bell rows clear immediately instead of
    // lingering for up to 30s until the next poll.
    { refetchQueries: ["Notifications"] },
  );
};

export const useDismissNotification = () => {
  return useMutation<{ dismissNotification: { id: string } }, { id: string }>(
    gql`
      mutation DismissNotification($id: ID!) {
        dismissNotification(id: $id) {
          id
        }
      }
    `,
    // Refetch the bell so the dismissed row leaves the popover
    // without waiting for the 30s poll.
    { refetchQueries: ["Notifications"] },
  );
};
