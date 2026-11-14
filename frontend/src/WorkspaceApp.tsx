import App from "./App";
import ContextMenus from "./ContextMenu";
import type { StartupIntent } from "./startupIntent";
import "./structure.css";
import "./equations.css";
import "mathlive/fonts.css";
import { Profiler, type ProfilerOnRenderCallback } from 'react';
import { recordOperation } from './operationPerformance';
const profileRender: ProfilerOnRenderCallback = (_id, _phase, duration, base, start, commit) =>
  recordOperation('react.commit', undefined, undefined, {duration,base,start,commit});
export default function WorkspaceApp({ initialIntent }: { initialIntent?: StartupIntent }) {
  const workspace = <><App initialIntent={initialIntent} /><ContextMenus /></>;
  return import.meta.env.VITE_ALDER_PROFILING === '1'
    ? <Profiler id="workspace" onRender={profileRender}>{workspace}</Profiler> : workspace;
}
