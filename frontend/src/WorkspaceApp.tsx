import App from "./App";
import ContextMenus from "./ContextMenu";
import type { StartupIntent } from "./startupIntent";
import "./structure.css";
import "./equations.css";
import "mathlive/fonts.css";
export default function WorkspaceApp({ initialIntent }: { initialIntent?: StartupIntent }) {
  return <><App initialIntent={initialIntent} /><ContextMenus /></>;
}
