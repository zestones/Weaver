// The families of labels Weaver knows by their name, when a project declares them. A project that names its families
// otherwise loses only what follows from the names: its cards are not graded, and each family takes several values.
export class LabelFamilies {
  // Grades the cards: its values are declared gravest first, and a card has one of them.
  static readonly LEVEL = 'level'
  // Where in the project a card is: a card may have several, and a list of cards says them under each title.
  static readonly AREA = 'area'
  // What kind of thing a card is about: a card has one.
  static readonly TYPE = 'type'

  // The families in the order they are shown: the level, the area and the type first, then the others as the
  // project declares them.
  readonly ordered: readonly string[]

  constructor(declared: readonly string[]) {
    const known = [LabelFamilies.LEVEL, LabelFamilies.AREA, LabelFamilies.TYPE]

    this.ordered = [...known.filter((family) => declared.includes(family)), ...declared.filter((family) => !known.includes(family))]
  }

  // Whether a card carries one value of this family at most.
  takesOne(family: string): boolean {
    return this.ordered.includes(family) && (family === LabelFamilies.LEVEL || family === LabelFamilies.TYPE)
  }
}
