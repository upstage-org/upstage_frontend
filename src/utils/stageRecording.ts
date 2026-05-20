/** In-progress performance (`recording: true`) exposed as activeRecording for live UI. */
export function deriveActiveRecording<
  T extends {
    performances?: Array<{
      id: string | number;
      name?: string;
      createdOn?: string;
      recording?: boolean;
    }> | null;
  },
>(
  stage: T | null | undefined,
): T & {
  activeRecording: { id: string | number; name?: string; createdOn?: string } | null;
} {
  if (!stage) {
    return { activeRecording: null } as T & {
      activeRecording: { id: string | number; name?: string; createdOn?: string } | null;
    };
  }
  const active = stage.performances?.find((p) => p.recording) ?? null;
  return {
    ...stage,
    activeRecording: active
      ? { id: active.id, name: active.name, createdOn: active.createdOn }
      : null,
  };
}
