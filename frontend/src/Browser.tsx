import { type ReactNode, useMemo, useState } from "react";
import {
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Library,
  BookOpen,
  AudioLines,
  Blocks,
  Type,
  SlidersHorizontal,
  FolderOpen,
  FileText,
  Star,
  Plus,
} from "lucide-react";
import ResizeHandle from "./ResizeHandle";
import { draftPeriods, matchesDraftPeriod } from "./draftFilters";
import type { Project, Idea } from "./types";
type Props = {
  project: Project;
  category: string;
  onCategory: (category: string) => void;
  voiceManager: ReactNode;
  libraryManager: ReactNode;
  onHide: () => void;
  ideas: Idea[];
  onInsert: (idea: Idea) => void;
  onSelectClip: (id: string) => void;
  onAddDevice: (type: string) => void;
  onPanel: (name: string) => void;
  onHint: (text: string) => void;
};
export const deviceCatalog = [
  {
    id: "spelling",
    name: "Spelling",
    description: "Check spelling using the local dictionary.",
  },
  {
    id: "repetition",
    name: "Repetition",
    description: "Find repeated words and phrases.",
  },
  {
    id: "verbosity",
    name: "Concision",
    description: "Find wordy expressions and consider a shorter alternative.",
  },
  {
    id: "sentence_length",
    name: "Sentence rhythm",
    description: "Inspect sentence length and reading pace.",
  },
  {
    id: "terminology",
    name: "Terminology",
    description: "Apply the preferred terms in your project dictionary.",
  },
  {
    id: "uppercase",
    name: "Upper case",
    description: "Preview a transformation to capital letters.",
  },
  {
    id: "lowercase",
    name: "Lower case",
    description: "Preview a transformation to lower case.",
  },
  {
    id: "sentence_case",
    name: "Sentence case",
    description: "Preview sentence capitalisation.",
  },
  {
    id: "title_case",
    name: "Title case",
    description: "Preview title-style capitalisation.",
  },
  {
    id: "trim_whitespace",
    name: "Whitespace",
    description: "Preview removing repeated spaces.",
  },
  {
    id: "tts",
    name: "Chatterbox",
    description: "Render language as speech using a local voice.",
  },
];
const categories = [
  { id: "Drafts", icon: Blocks },
  { id: "Words", icon: BookOpen },
  { id: "Language Tools", icon: SlidersHorizontal },
  { id: "Voices", icon: AudioLines },
  { id: "Styles", icon: Type },
  { id: "Templates", icon: FileText },
];
export default function Browser({
  project,
  category,
  onCategory: setCategory,
  voiceManager,
  libraryManager,
  onHide,
  ideas,
  onInsert,
  onSelectClip,
  onAddDevice,
  onPanel,
  onHint,
}: Props) {
  const savedSize = (
    key: string,
    fallback: number,
    min: number,
    max: number,
  ) => {
    const value = Number(localStorage.getItem(key) || fallback);
    return Number.isFinite(value)
      ? Math.max(min, Math.min(max, value))
      : fallback;
  };
  const [navWidth, setNavWidth] = useState(() =>
    savedSize("alder.collectionsWidth", 150, 100, 360),
  );
  const [filterHeight, setFilterHeight] = useState(() =>
    savedSize("alder.filtersHeight", 155, 60, 500),
  );
  const managed = [
    "Voices",
    "Styles",
    "Templates",
    "Projects",
    "Project Assets",
  ].includes(category);
  const [filter, setFilter] = useState("All"),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<Idea | null>(null),
    [favourites, setFavourites] = useState<string[]>(() =>
      JSON.parse(localStorage.getItem("alder.favourites") || "[]"),
    );
  const allIdeas = useMemo(() => {
    const map = new Map(ideas.map((i) => [i.id, i]));
    project.ideas.forEach((i) => map.set(i.id, i));
    return [...map.values()];
  }, [ideas, project.ideas]);
  const ideaCats = [
    "All",
    ...Array.from(new Set(allIdeas.map((i) => i.category))),
  ];
  const visible = allIdeas.filter(
    (i) =>
      (filter === "All" || i.category === filter) &&
      (category !== "Favourites" || favourites.includes(i.id)) &&
      `${i.word} ${i.definition} ${i.tags.join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const favourite = (id: string) => {
    const next = favourites.includes(id)
      ? favourites.filter((x) => x !== id)
      : [...favourites, id];
    setFavourites(next);
    localStorage.setItem("alder.favourites", JSON.stringify(next));
  };
  const pickCategory = (name: string) => {
    setCategory(name);
    setFilter("All");
    setSearch("");
    if (["Styles", "Templates", "Projects", "Project Assets"].includes(name))
      onPanel(name === "Project Assets" ? "assets" : name.toLowerCase());
  };
  return (
    <aside className="browser pane" aria-label="Language browser">
      <div className="browser-search">
        <Search size={15} />
        <input
          aria-label="Search library"
          placeholder="Search Library (Ctrl+F)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button aria-label="Clear search" onClick={() => setSearch("")}>
            ×
          </button>
        )}
        <button
          aria-label="Toggle Left Panel"
          aria-expanded="true"
          onClick={onHide}
          data-help="Hide the library panel. Use the arrow beside the writing area to show it again."
        >
          <ChevronLeft size={12} />
        </button>
      </div>
      <div className="browser-main">
        <nav
          className="browser-nav"
          aria-label="Collections And Library"
          style={{ width: `min(${navWidth}px, calc(100% - 106px))` }}
        >
          <div className="nav-label">Collections</div>
          <button
            className={category === "Favourites" ? "selected" : ""}
            onClick={() => pickCategory("Favourites")}
          >
            <span className="collection-dot" />
            Favourites
          </button>
          <div className="nav-label separated">Library</div>
          {categories.map(({ id, icon: Icon }) => (
            <button
              key={id}
              className={category === id ? "selected" : ""}
              onClick={() => pickCategory(id)}
            >
              <Icon size={15} />
              {id}
            </button>
          ))}
          <div className="nav-label separated">Places</div>
          <button
            className={category === "Projects" ? "selected" : ""}
            onClick={() => pickCategory("Projects")}
          >
            <FolderOpen size={15} />
            Projects
          </button>
          <button
            className={category === "Project Assets" ? "selected" : ""}
            onClick={() => pickCategory("Project Assets")}
          >
            <Library size={15} />
            Project Assets
          </button>
          <button onClick={() => onPanel("import")}>
            <Plus size={15} />
            Import…
          </button>
          <button onClick={() => onPanel("ideas")}>
            <Plus size={15} />
            Add a Word…
          </button>
        </nav>
        <ResizeHandle
          label="Resize Collections And Content"
          orientation="vertical"
          value={navWidth}
          min={100}
          max={360}
          onChange={(value) => {
            setNavWidth(value);
            localStorage.setItem("alder.collectionsWidth", String(value));
          }}
        />
        <div className="browser-results">
          {!managed && (
            <>
              <section
                className="browser-filters"
                aria-label="Library Filters"
                style={{ height: filterHeight }}
              >
                <div className="filter-header">
                  <ChevronDown size={13} /> Filters{" "}
                  <SlidersHorizontal size={13} />
                </div>
                <div className="filter-area">
                  <strong>{category}</strong>
                  <div className="filter-chips">
                    {(category === "Language Tools"
                      ? ["All", "Analysis", "Transform", "Speech"]
                      : category === "Drafts"
                        ? draftPeriods
                        : ideaCats
                    ).map((f) => (
                      <button
                        key={f}
                        className={filter === f ? "active" : ""}
                        onClick={() => setFilter(f)}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
              </section>
              <ResizeHandle
                label="Resize Filters And Content"
                orientation="horizontal"
                value={filterHeight}
                min={60}
                max={500}
                onChange={(value) => {
                  setFilterHeight(value);
                  localStorage.setItem("alder.filtersHeight", String(value));
                }}
              />
              <div className="list-heading">
                <span>Name</span>
                <span>Type</span>
              </div>
            </>
          )}
          <div className="library-list">
            {managed ? (
              <section
                className="browser-voices library-manager"
                aria-label={
                  category === "Voices" ? "Voice Management" : category
                }
              >
                <h3>{category}</h3>
                {category === "Voices" ? voiceManager : libraryManager}
              </section>
            ) : (
              <>
                {["Words", "Favourites"].includes(category) ? (
                  visible.map((idea) => (
                    <div className="library-word-row" key={idea.id}>
                      <button
                        className={
                          "library-item " +
                          (selected?.id === idea.id ? "selected" : "")
                        }
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData(
                            "application/x-alder-idea",
                            JSON.stringify(idea),
                          );
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                        onClick={() => {
                          setSelected(idea);
                          onHint(idea.definition);
                        }}
                        onDoubleClick={() => onInsert(idea)}
                      >
                        <span className="idea-glyph">
                          {idea.category === "Prime" ? "◈" : "◇"}
                        </span>
                        <span>{idea.word}</span>
                        <small>{idea.pos}</small>
                      </button>
                      <button
                        className="word-favourite"
                        aria-label={`${favourites.includes(idea.id) ? "Remove" : "Add"} ${idea.word} ${favourites.includes(idea.id) ? "From" : "To"} Favourites`}
                        aria-pressed={favourites.includes(idea.id)}
                        onClick={() => favourite(idea.id)}
                      >
                        <Star
                          size={12}
                          fill={
                            favourites.includes(idea.id)
                              ? "currentColor"
                              : "none"
                          }
                        />
                      </button>
                    </div>
                  ))
                ) : category === "Drafts" ? (
                  project.clips
                    .filter((c) => matchesDraftPeriod(c, filter))
                    .sort((a, b) =>
                      (b.updatedAt || "").localeCompare(a.updatedAt || ""),
                    )
                    .filter((c) =>
                      `${c.title} ${c.text}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    )
                    .map((c) => (
                      <button
                        key={c.id}
                        className="library-item"
                        draggable
                        onDragStart={(e) =>
                          e.dataTransfer.setData(
                            "application/x-alder-clip",
                            c.id,
                          )
                        }
                        onClick={() => onSelectClip(c.id)}
                      >
                        <Blocks size={13} />
                        <span>{c.title}</span>
                        <small>draft</small>
                      </button>
                    ))
                ) : category === "Language Tools" ? (
                  deviceCatalog
                    .filter(
                      (d) =>
                        d.name.toLowerCase().includes(search.toLowerCase()) &&
                        (filter === "All" ||
                          (filter === "Analysis" &&
                            [
                              "spelling",
                              "repetition",
                              "verbosity",
                              "sentence_length",
                              "terminology",
                            ].includes(d.id)) ||
                          (filter === "Transform" &&
                            [
                              "uppercase",
                              "lowercase",
                              "sentence_case",
                              "title_case",
                              "trim_whitespace",
                            ].includes(d.id)) ||
                          (filter === "Speech" && d.id === "tts")),
                    )
                    .map((d) => (
                      <button
                        key={d.id}
                        className="library-item"
                        draggable
                        onDragStart={(e) =>
                          e.dataTransfer.setData(
                            "application/x-alder-device",
                            d.id,
                          )
                        }
                        onClick={() => onHint(d.description)}
                        onDoubleClick={() => onAddDevice(d.id)}
                      >
                        <SlidersHorizontal size={13} />
                        <span>{d.name}</span>
                        <ChevronRight size={12} />
                      </button>
                    ))
                ) : (
                  <div className="browser-empty">
                    Manage {category.toLowerCase()}
                    <button onClick={() => onPanel(category.toLowerCase())}>
                      Open {category.toLowerCase()}
                    </button>
                  </div>
                )}
                {["Words", "Favourites"].includes(category) &&
                  !visible.length && (
                    <p className="empty-small">
                      No matching words. Try another filter or add your own
                      word.
                    </p>
                  )}
              </>
            )}
          </div>
        </div>
      </div>
      {!managed && <div className="browser-bottom-space" aria-hidden="true" />}
    </aside>
  );
}
