# House rules of the vault

This folder is one person's vault. Every AI in Lattice reads these house rules first, every turn; the learner can edit them directly, and once edited, the edited version applies.

## Folders

- `topics/` topics, `cards/` cards, `lessons/` lessons, `notes/` notes (subfolders as you like), `insights/` weak spots and things done well: all Markdown, with properties in YAML at the start.
- `apps/` small apps: .html files made by App builder, running in the sandbox of the “Apps” window (they can reach the internet, cannot reach this computer or the local network, and cannot read the vault); the libraries and assets they use are in `apps/assets/`.
- `notebooks/` notebooks: standard `.ipynb`, with properties in `metadata.lattice`.
- `code/` code, `data/` data, `books/` ebooks: kept as they are and referenced by path.
- `envs/<name>.txt`: the definition of a Python environment, one package per line. Put a `.lattice-env` file in a folder (its content is the environment's name), and the files under that folder use that environment; by default `default` is used.
- `threads/` conversations, `journal/` journal: JSON lines, append only.
- `annotations/` highlights and annotations: one JSON file per annotated thing. `source` is that thing (a document id, `file:<path>`, `thread:<id>` or `web:<url>`), `items` are the annotations one by one, and each one's `anchor` records the position (`at`) and the original text (`text`, `before`, `after`), which is used to find it again after the file has changed. Elsewhere, `ann:<id>` points to one annotation.
- `agents/<name>.md`: optional. Put a file with the same name here to rewrite how that AI works.
- `.lattice/`: indexes and this computer's state; can be rebuilt if deleted.

## Properties

- Every Markdown document has `id`, `kind`, `title`, `by` (`me` or which AI), `created`, `updated`; as needed, `topic` (the id of the topic it belongs to) and `links`.
- `links` is a list of relations `{id, to, as, why}`. `to` is another document's id, or `file:<path>`; `as` is `prerequisite`, `part_of` (is a part of), `related`, `applies_to`, `contrasts`, `explains` (what about `to` this content explains).
- Topics: `question` (the question to understand), `parent` (the parent topic), `state` (`active` / `parked` / `completed`), `route` (the main route, a list of `{title, ref?, why?}`); the body is the topic profile.
- Cards: `stage` (`suggested` to explore / `seen` seen / `explained` can explain / `applied` can apply), `question` (a self-test question), `tags`, `due`, `reviews`; the body is the explanation, and the `## 我的理解` (My understanding) section is written by the learner.
- References always use ids; folders are only a default arrangement for people to look at, and carry no meaning.

## Who can change what

- Structured state such as the knowledge map, routes, the journal, weak spots and topic profiles is changed with Lattice commands, not by editing these properties directly.
- Ordinary content (note bodies, code, data) can be changed directly from the command line.
- A card's `stage`, `due`, `reviews` and `## 我的理解`, the learner's side of the journal, review self-ratings: these belong only to the learner. An AI can read them but not change them; changes made from the command line are reverted automatically.
- Only the learner deletes.
- `threads/`, `journal/`, `annotations/`, `AGENTS.md`, `agents/`, `.lattice/` are maintained only by Lattice and the learner; an AI leaves annotations with `annotate`.
- Every AI action is committed to git separately, and the learner can undo it.
