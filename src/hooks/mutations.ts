import { message } from "ant-design-vue";
import { ref } from "vue";
import { userGraph } from "@services/graphql";

interface LoadingMessages<U> {
  /**
   * Loading message displayed while the operation is in progress.
   */
  loading: string;
  /**
   * Success message factory; receives the operation result.
   */
  success: (result: U) => string;
  /**
   * Custom error message factory; if omitted, the server error message is used.
   */
  error?: (exception: unknown) => string;
  /**
   * Auto-dismiss duration of the response toast in seconds. `0` makes it permanent.
   */
  seconds?: number;
}

interface UpdateUserPayload {
  id: string | number;
  username?: string;
  password?: string;
  email?: string;
  binName?: string;
  role?: string | number;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  active?: boolean;
  uploadLimit?: number;
  intro?: string;
}

export function useLoading<T extends unknown[], U>(
  operation: (...params: T) => Promise<U>,
  messages?: LoadingMessages<U>,
) {
  const key = +new Date();
  const loading = ref(false);

  return {
    loading,
    proceed: async (...params: T): Promise<U | undefined> => {
      loading.value = true;
      if (messages) {
        message.loading({ content: messages.loading, key, duration: 0 });
      }
      try {
        const result = await operation(...params);
        if (messages) {
          message.success({
            content: messages.success(result),
            key,
            duration: messages.seconds,
          });
        }
        return result;
      } catch (error) {
        if (messages) {
          let content: string;
          if (messages.error) {
            content = messages.error(error);
          } else if (typeof error === "string") {
            content = error;
          } else {
            const maybe = error as
              | { response?: { errors?: Array<{ message?: string }> }; message?: string }
              | undefined;
            content =
              maybe?.response?.errors?.[0]?.message ?? maybe?.message ?? "An error occurred";
          }
          message.error({ content, key, duration: messages.seconds });
        }
        return undefined;
      } finally {
        loading.value = false;
      }
    },
  };
}

export function useUpdateUser(
  messages?: LoadingMessages<unknown>,
) {
  return useLoading(async (user: UpdateUserPayload, includingPassword?: boolean) => {
    const {
      username,
      password,
      email,
      binName,
      role,
      firstName,
      lastName,
      displayName,
      active,
      uploadLimit,
      intro,
      id,
    } = user;
    const inbound: Record<string, unknown> = {
      username,
      email,
      binName,
      role,
      firstName,
      lastName,
      displayName,
      active,
      uploadLimit,
      intro,
      id,
    };
    if (includingPassword) {
      inbound.password = password;
    }
    return userGraph.updateUser(inbound);
  }, messages);
}
