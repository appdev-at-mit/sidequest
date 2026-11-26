import { useEffect, useRef } from "react";
import type { RefObject } from "react";

type DismissibleEntry = {
  group?: string;
  root: () => HTMLElement | null;
  contains: (node: Node) => boolean;
  dismiss: () => void;
};

const activeEntries: DismissibleEntry[] = [];
let listenersAttached = false;

function detachGlobalListenersIfIdle() {
  if (activeEntries.length || !listenersAttached) return;
  document.removeEventListener("pointerdown", onGlobalPointerDown, true);
  document.removeEventListener("keydown", onGlobalKeyDown, true);
  listenersAttached = false;
}

function onGlobalPointerDown(event: PointerEvent) {
  if (!(event.target instanceof Node)) return;
  for (const entry of [...activeEntries].reverse()) {
    if (!entry.contains(event.target)) entry.dismiss();
  }
}

function onGlobalKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape" || !activeEntries.length) return;
  event.preventDefault();
  event.stopPropagation();
  activeEntries.at(-1)?.dismiss();
}

export default function useDismissible<T extends HTMLElement = HTMLElement>(
  open: boolean,
  onDismiss: () => void,
  group?: string,
  additionalRefs: RefObject<HTMLElement | null>[] = [],
) {
  const rootRef = useRef<T>(null);
  const additionalRefsRef = useRef(additionalRefs);
  const onDismissRef = useRef(onDismiss);
  additionalRefsRef.current = additionalRefs;
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    const entry: DismissibleEntry = {
      group,
      root: () => rootRef.current,
      contains: node => rootRef.current?.contains(node) === true
        || additionalRefsRef.current.some(ref => ref.current?.contains(node) === true),
      dismiss: () => onDismissRef.current(),
    };

    if (group) {
      const newRoot = rootRef.current;
      for (const previous of [...activeEntries].reverse()) {
        if (previous.group !== group) continue;
        const previousRoot = previous.root();
        const nested = Boolean(newRoot && previous.contains(newRoot)) || Boolean(previousRoot && entry.contains(previousRoot));
        if (!nested) previous.dismiss();
      }
    }
    activeEntries.push(entry);
    if (!listenersAttached) {
      document.addEventListener("pointerdown", onGlobalPointerDown, true);
      document.addEventListener("keydown", onGlobalKeyDown, true);
      listenersAttached = true;
    }
    return () => {
      const index = activeEntries.indexOf(entry);
      if (index >= 0) activeEntries.splice(index, 1);
      detachGlobalListenersIfIdle();
    };
  }, [open, group]);

  return rootRef;
}
