import { expect,it } from "vitest";
import { authoringCommand } from "./authoringCommands";
import { searchableCommands } from "./CommandSearch";

it("keeps IDs stable across display aliases and command invocation",()=>{
  const command=authoringCommand("Insert table of contents…");
  expect(authoringCommand("Table of contents…").id).toBe(command.id);
  expect(authoringCommand(command.id)).toEqual(command);
  expect(authoringCommand("Paragraph…").keywords).toContain("hanging");
  const fallback=authoringCommand("Distribute columns evenly");
  expect(authoringCommand(fallback.id).id).toBe(fallback.id);
});
it("keeps unavailable descendants disabled in search and excludes the search command itself",()=>{
  const action=()=>{};
  const result=searchableCommands({Edit:[{label:"Find command…",action},
    {label:"Formatting",disabled:true,submenu:[{label:"Paragraph…",action}]}]});
  expect(result).toHaveLength(1);
  expect(result[0].item.disabled).toBe(true);
  expect(result[0].path).toBe("Edit → Formatting → Paragraph…");
});
