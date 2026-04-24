"use client";

import { useEffect } from "react";

/**
 * Re-run `reload` whenever the active project changes.
 *
 * Used by every list/table view that honors the X-Project-Id header. The
 * ProjectSwitcher dispatches a "projectchange" event after persisting the
 * new choice; subscribing to it means we don't have to thread the project
 * id through every page's props.
 */
export function useProjectScope(reload: () => void): void {
  useEffect(() => {
    function onChange() {
      reload();
    }
    window.addEventListener("projectchange", onChange);
    return () => window.removeEventListener("projectchange", onChange);
  }, [reload]);
}
