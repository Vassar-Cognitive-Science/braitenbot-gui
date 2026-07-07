// Transaction origins tag every doc mutation so the undo manager (and, later,
// remote-sync code) can decide what to track. `LOCAL` is the only origin the
// UndoManager tracks — everything else is intentionally invisible to undo.
export const ORIGIN_LOCAL = Symbol('braitenbot:local');
// Cheap, repeatable tweaks that today carried no undo entry: badge drag,
// trace-mode constant slider / arrow-key nudge, resize-driven motor snap.
export const ORIGIN_UNTRACKED = Symbol('braitenbot:untracked');
// The invariant-repair pass. Runs after undo/redo and after remote updates;
// its edits must never become undo entries of their own.
export const ORIGIN_REPAIR = Symbol('braitenbot:repair');
// Updates applied from a collaborative session peer (via the SessionManager's
// sync provider). Never undoable locally; triggers the debounced repair pass.
export const ORIGIN_REMOTE = Symbol('braitenbot:remote');
