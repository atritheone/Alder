import { lazy, Suspense, type ComponentType, type ComponentProps } from "react";

/** Keep a dialog/preview's loading boundary local so the editor stays mounted. */
export function deferredComponent<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  const Component = lazy(load);
  return function Deferred(props: ComponentProps<T>) {
    return <Suspense fallback={<div className="open-progress" role="status">Opening…</div>}><Component {...props} /></Suspense>;
  };
}
