import { useBlocker } from "@tanstack/react-router";
import { useCallback } from "react";

const MESSAGE = "You have unsaved changes. Leave without saving?";

export function useUnsavedChangesWarning(isDirty: boolean) {
    const shouldBlockFn = useCallback(() => isDirty && !window.confirm(MESSAGE), [isDirty]);

    useBlocker({
        shouldBlockFn,
        enableBeforeUnload: isDirty,
    });
}
