/** Original paragraph identities and picture ordinals survive remeasurement.
 * A paragraph cursor is an absolute offset in the complete note's text. */
export type NoteProgress = {
  paragraphs: [number, number][];
  pictures: number[];
};
