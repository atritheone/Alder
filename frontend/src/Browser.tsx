import { type ReactNode, useMemo, useState } from "react";
import {
  Search,
  ChevronDown,
  ChevronRight,
  Library,
  Lightbulb,
  BookOpen,
  AudioLines,
  Blocks,
  Type,
  SlidersHorizontal,
  FolderOpen,
  FileText,
  Star,
  Plus,
  GripVertical,
} from "lucide-react";
import type { Project, Idea } from "./types";
type Props = {
  project: Project;
  category: string;
  onCategory: (category: string) => void;
  voiceManager: ReactNode;
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
  { id: "Ideas", icon: Lightbulb },
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
  ideas,
  onInsert,
  onSelectClip,
  onAddDevice,
  onPanel,
  onHint,
}: Props) {
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
    if (["Styles", "Templates"].includes(name)) onPanel(name.toLowerCase());
  };
  return (
    <aside className="browser pane" aria-label="Language browser">
      <div className="browser-search">
        <Search size={15} />
        <input
          aria-label="Search library"
          placeholder="Search library (Ctrl+F)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button aria-label="Clear search" onClick={() => setSearch("")}>
            ×
          </button>
        )}
      </div>
      <div className="browser-main">
        <nav className="browser-nav">
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
          <button onClick={() => onPanel("projects")}>
            <FolderOpen size={15} />
            Projects
          </button>
          <button onClick={() => onPanel("assets")}>
            <Library size={15} />
            Project Assets
          </button>
          <button onClick={() => onPanel("import")}>
            <Plus size={15} />
            Import…
          </button>
          <button onClick={() => onPanel("ideas")}>
            <Plus size={15} />
            Add an idea…
          </button>
        </nav>
        <div className="browser-results">
          {category !== "Voices" && (
            <>
              <div className="filter-header">
                <ChevronDown size={13} /> Filters{" "}
                <SlidersHorizontal size={13} />
              </div>
              <div className="filter-area">
                <strong>{category}</strong>
                <div className="filter-chips">
                  {(category === "Language Tools"
                    ? ["All", "Analysis", "Transform", "Speech"]
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
              <div className="list-heading">
                <span>Name</span>
                <span>Type</span>
              </div>
            </>
          )}
          <div className="library-list">
            {category === "Voices" ? (
              <section className="browser-voices" aria-label="Voice Management">
                <h3>Voices</h3>
                {voiceManager}
              </section>
            ) : (
              <>
                {["Ideas", "Words", "Favourites"].includes(category) ? (
                  visible.map((idea) => (
                    <button
                      key={idea.id}
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
                  ))
                ) : category === "Drafts" ? (
                  project.clips
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
                {["Ideas", "Words", "Favourites"].includes(category) &&
                  !visible.length && (
                    <p className="empty-small">
                      No matching samples. Try another filter or add your own
                      idea.
                    </p>
                  )}
              </>
            )}
          </div>
        </div>
      </div>
      {category !== "Voices" && (
        <div className="browser-preview">
          {selected ? (
            <>
              <div>
                <strong>{selected.word}</strong>
                <span>
                  {selected.category} · {selected.pos}
                </span>
                <button
                  aria-label="Favourite idea"
                  className={
                    favourites.includes(selected.id) ? "favourited" : ""
                  }
                  onClick={() => favourite(selected.id)}
                >
                  <Star size={13} />
                </button>
              </div>
              <p>{selected.definition}</p>
              <div>
                <button onClick={() => onInsert(selected)}>
                  Insert sample
                </button>
                <span className="quiet">Drag into a draft</span>
              </div>
            </>
          ) : (
            <>
              <strong>Ideas are language samples</strong>
              <p>
                Browse a category, then drag a word into your writing.
                Double-click to insert.
              </p>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
